// Partner subscriptions — the 3-month free trial and the monthly invoice.
// HANDOFF §7ter.
//
// The rules worth pinning, all of which are ways this could quietly go wrong:
// the clock starts at approval and never restarts; a partner in their trial is
// not invoiced; the fee is frozen at issue so editing it never reprices a month
// already billed; an unset fee produces **no invoice** rather than a ₹0 one;
// the job is re-runnable and self-heals a missed month; and marking an invoice
// paid is a claim, so a double tap or a racing webhook records one payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import {
  addMonths,
  ensureSubscription,
  issueInvoicesFor,
  runBilling,
  subscriptionPhase,
  periodsToInvoice
} from '../src/lib/subscription.js';

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

// A fixed clock, so nothing in this file depends on what day it is run.
const APPROVED = new Date('2026-01-15T00:00:00Z');
const IN_TRIAL = new Date('2026-03-01T00:00:00Z');    // month 2 of 3
const AFTER_TRIAL = new Date('2026-04-20T00:00:00Z'); // the trial ended on 15 April

let master;
let industry;

async function world() {
  await resetDb();
  const base = await seedBaseline();
  master = base.master;
  industry = base.industry;
  await setConfig(CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP, 3000);
  await setConfig(CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR, 5000);
  return base;
}

async function makePartner({ role = 'SHOP', approvedAt = APPROVED, isActive = true, email } = {}) {
  return prisma.user.create({
    data: {
      email: email ?? `${role.toLowerCase()}-${crypto.randomUUID()}@test.roadmate`,
      password: 'x',
      name: `Test ${role}`,
      role,
      isActive,
      approvedAt,
      industryId: industry.id
    }
  });
}

test.after(disconnect);

// --- the clock ---------------------------------------------------------------

test('addMonths clamps to the end of a shorter month', () => {
  // A partner approved on the 31st must not have a period that silently rolls
  // into the following month and issues two invoices in one month.
  assert.equal(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addMonths(new Date('2026-01-31T00:00:00Z'), 3).toISOString().slice(0, 10), '2026-04-30');
  assert.equal(addMonths(new Date('2026-01-15T00:00:00Z'), 3).toISOString().slice(0, 10), '2026-04-15');
});

test('the trial runs three months from approval, not from signup', async () => {
  await world();
  const shop = await makePartner();

  const sub = await ensureSubscription(shop);
  assert.equal(sub.trialStartedAt.toISOString(), APPROVED.toISOString());
  assert.equal(sub.trialEndsAt.toISOString().slice(0, 10), '2026-04-15');
  // The first paid period starts the day the trial ends — no gap, no overlap.
  assert.equal(sub.billingAnchorAt.toISOString(), sub.trialEndsAt.toISOString());
});

test('a partner approved before approval dates were recorded gets no subscription, not a guessed one', async () => {
  await world();
  const shop = await makePartner({ approvedAt: null });

  assert.equal(await ensureSubscription(shop), null);
  const { skipped } = await issueInvoicesFor(shop, { now: AFTER_TRIAL });
  assert.equal(skipped, 'NO_APPROVAL_DATE');
  assert.equal(await prisma.subscriptionInvoice.count(), 0);
});

test('re-approving does not restart a running trial', async () => {
  await world();
  const shop = await makePartner();
  const first = await ensureSubscription(shop);

  // The approval endpoint is a plain idempotent update and may be called twice.
  const res = await request(app).post(`/api/partners/${shop.id}/approve`).set(auth(master));
  assert.equal(res.status, 200);

  const after = await prisma.partnerSubscription.findUnique({ where: { userId: shop.id } });
  assert.equal(after.id, first.id);
  assert.equal(after.trialEndsAt.toISOString(), first.trialEndsAt.toISOString());
});

test('approving a partner creates the subscription there and then', async () => {
  await world();
  const shop = await prisma.user.create({
    data: {
      email: `pending-${crypto.randomUUID()}@test.roadmate`,
      password: 'x', name: 'Pending Shop', role: 'SHOP', isActive: false, industryId: industry.id
    }
  });

  await request(app).post(`/api/partners/${shop.id}/approve`).set(auth(master)).expect(200);

  const sub = await prisma.partnerSubscription.findUnique({ where: { userId: shop.id } });
  assert.ok(sub, 'the trial clock starts at approval');
  const approved = await prisma.user.findUnique({ where: { id: shop.id } });
  assert.equal(sub.trialStartedAt.toISOString(), approved.approvedAt.toISOString());
});

test('a REGIONAL partner and a rider are never billed', async () => {
  await world();
  const regional = await makePartner({ role: 'REGIONAL' });
  assert.equal(await ensureSubscription(regional), null);

  const res = await request(app).get('/api/billing/me').set(auth(regional));
  assert.equal(res.status, 200);
  assert.equal(res.body.billable, false);
  assert.equal(res.body.phase, 'NONE');
});

// --- issuing -----------------------------------------------------------------

test('nothing is invoiced during the trial', async () => {
  await world();
  const shop = await makePartner();

  const { issued, skipped } = await issueInvoicesFor(shop, { now: IN_TRIAL });
  assert.equal(issued.length, 0);
  assert.equal(skipped, 'TRIAL');
  assert.equal(subscriptionPhase(await ensureSubscription(shop), [], IN_TRIAL), 'TRIAL');
});

test('the first invoice lands the day the trial ends, at the configured fee', async () => {
  await world();
  const shop = await makePartner();

  const justAfter = new Date('2026-04-15T06:00:00Z');
  const { issued } = await issueInvoicesFor(shop, { now: justAfter });
  assert.equal(issued.length, 1);
  assert.equal(issued[0].amount.toFixed(2), '3000.00');
  assert.equal(issued[0].periodStart.toISOString().slice(0, 10), '2026-04-15');
  assert.equal(issued[0].periodEnd.toISOString().slice(0, 10), '2026-05-15');
  assert.equal(issued[0].number, `RM-SUB-202604-${String(shop.id).padStart(5, '0')}`);
  assert.equal(issued[0].status, 'DUE');
});

test('an unset fee produces no invoice at all — not a ₹0 one', async () => {
  await world();
  // subscription_fee_manufacturer has no row and no code default, on purpose.
  const manufacturer = await makePartner({ role: 'MANUFACTURER' });

  const { issued, skipped } = await issueInvoicesFor(manufacturer, { now: AFTER_TRIAL });
  assert.equal(issued.length, 0);
  assert.equal(skipped, 'FEE_NOT_SET');
  assert.equal(await prisma.subscriptionInvoice.count(), 0);
});

test('the fee is frozen at issue: raising it never reprices a month already billed', async () => {
  await world();
  const shop = await makePartner();
  const { issued } = await issueInvoicesFor(shop, { now: new Date('2026-04-16T00:00:00Z') });
  assert.equal(issued[0].amount.toFixed(2), '3000.00');

  await setConfig(CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP, 4500);
  const reread = await prisma.subscriptionInvoice.findUnique({ where: { id: issued[0].id } });
  assert.equal(reread.amount.toFixed(2), '3000.00', 'April is still April’s price');

  // ...and next month is the new one.
  const next = await issueInvoicesFor(shop, { now: new Date('2026-05-16T00:00:00Z') });
  assert.equal(next.issued.length, 1);
  assert.equal(next.issued[0].amount.toFixed(2), '4500.00');
});

test('the run is re-runnable, and a missed month self-heals with its real dates', async () => {
  await world();
  const shop = await makePartner();

  // Nobody ran the job for three months.
  const first = await runBilling({ now: new Date('2026-07-01T00:00:00Z') });
  assert.equal(first.issued, 3, 'April, May and June');
  assert.equal(first.totalAmount.toFixed(2), '9000.00');

  const starts = (await prisma.subscriptionInvoice.findMany({ orderBy: { periodStart: 'asc' } }))
    .map((i) => i.periodStart.toISOString().slice(0, 10));
  assert.deepEqual(starts, ['2026-04-15', '2026-05-15', '2026-06-15']);

  // Running it again the same hour issues nothing — @@unique(subscriptionId, periodStart).
  const again = await runBilling({ now: new Date('2026-07-01T00:00:00Z') });
  assert.equal(again.issued, 0);
  assert.equal(await prisma.subscriptionInvoice.count(), 3);
});

test('a deactivated partner is not billed', async () => {
  await world();
  await makePartner({ isActive: false });

  const result = await runBilling({ now: AFTER_TRIAL });
  assert.equal(result.issued, 0);
  assert.equal(await prisma.subscriptionInvoice.count(), 0);
});

test('cancelling stops future invoices and leaves issued ones owed', async () => {
  await world();
  const shop = await makePartner();
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') }); // one invoice

  const res = await request(app)
    .post(`/api/master/billing/partners/${shop.id}/cancel`)
    .set(auth(master))
    .send({ note: 'closed the shop' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.phase, 'CANCELLED');
  assert.equal(res.body.amountDue, '3000.00', 'the month they used is still owed');

  // A later run may still issue periods that *started* before the cancellation
  // — those months were used and are owed. What it must never issue is a period
  // beginning after the partner left.
  await runBilling({ now: new Date('2027-06-01T00:00:00Z') });
  const cancelledAt = (await prisma.partnerSubscription.findUnique({ where: { userId: shop.id } })).cancelledAt;
  const invoices = await prisma.subscriptionInvoice.findMany();
  assert.ok(invoices.length >= 1);
  assert.ok(
    invoices.every((i) => i.periodStart <= cancelledAt),
    'nothing is billed for a period that began after the partner left'
  );
});

test('periodsToInvoice stops at the cancellation, not at now', async () => {
  const sub = {
    billingAnchorAt: new Date('2026-04-15T00:00:00Z'),
    cancelledAt: new Date('2026-05-20T00:00:00Z')
  };
  const periods = periodsToInvoice(sub, new Date('2026-09-01T00:00:00Z'));
  assert.equal(periods.length, 2, 'April and May; June onwards never happened');
});

// --- the partner's own view --------------------------------------------------

test('GET /api/billing/me shows the trial, then what is owed', async () => {
  await world();
  const shop = await makePartner();

  const res = await request(app).get('/api/billing/me').set(auth(shop));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.billable, true);
  assert.equal(res.body.trialStartKnown, true);
  assert.equal(res.body.monthlyFee, '3000.00');
  assert.equal(res.body.feeConfigured, true);
  assert.equal(res.body.amountDue, '0.00');
  assert.equal(res.body.invoices.length, 0);
  // Money is a fixed-2 string on the wire, like every other B2C amount.
  assert.equal(typeof res.body.amountDue, 'string');

  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const after = await request(app).get('/api/billing/me').set(auth(shop));
  assert.equal(after.body.invoices.length, 1);
  assert.equal(after.body.amountDue, '3000.00');
  assert.equal(after.body.outstandingCount, 1);
});

test('phase is derived, so an unpaid invoice past its due date reads PAST_DUE', async () => {
  await world();
  const shop = await makePartner();
  const sub = await ensureSubscription(shop);
  const invoices = [{ status: 'DUE', dueAt: new Date('2026-04-22T00:00:00Z'), amount: 3000 }];

  assert.equal(subscriptionPhase(sub, invoices, new Date('2026-04-20T00:00:00Z')), 'ACTIVE');
  assert.equal(subscriptionPhase(sub, invoices, new Date('2026-04-25T00:00:00Z')), 'PAST_DUE');
});

test('a partner can only ask for a payment link for their own invoice', async () => {
  await world();
  const shop = await makePartner();
  const other = await makePartner({ role: 'DISTRIBUTOR' });
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const invoice = await prisma.subscriptionInvoice.findFirst({
    where: { subscription: { userId: shop.id } }
  });

  const stolen = await request(app)
    .post(`/api/billing/invoices/${invoice.id}/pay-link`)
    .set(auth(other));
  assert.equal(stolen.status, 404, 'somebody else’s bill is not found, not forbidden');

  const mine = await request(app)
    .post(`/api/billing/invoices/${invoice.id}/pay-link`)
    .set(auth(shop));
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  assert.ok(mine.body.invoice.paymentLinkUrl);
  // No Razorpay credentials in .env.test — the seam stubs out and says so,
  // exactly like razorpay.js, sms.js and cloudinary.js.
  assert.equal(mine.body.live, false);
});

test('a second pay-link request returns the first link, never a second one', async () => {
  await world();
  const shop = await makePartner();
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const invoice = await prisma.subscriptionInvoice.findFirst();

  const first = await request(app).post(`/api/billing/invoices/${invoice.id}/pay-link`).set(auth(shop));
  const second = await request(app).post(`/api/billing/invoices/${invoice.id}/pay-link`).set(auth(shop));

  assert.equal(second.status, 200);
  assert.equal(second.body.reused, true);
  assert.equal(second.body.invoice.paymentLinkUrl, first.body.invoice.paymentLinkUrl);
});

// --- the platform's side -----------------------------------------------------

test('the Master billing view is MASTER-only and counts both silent failures', async () => {
  await world();
  const shop = await makePartner();
  await makePartner({ role: 'MANUFACTURER' });              // no fee configured
  await makePartner({ role: 'DISTRIBUTOR', approvedAt: null }); // no approval date

  assert.equal((await request(app).get('/api/master/billing').set(auth(shop))).status, 403);

  const res = await request(app).get('/api/master/billing').set(auth(master));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.partners.length, 4, 'three plus seedBaseline’s shop');
  assert.equal(res.body.totals.feeNotSet, 1);
  assert.equal(res.body.totals.trialStartUnknown, 2, 'the distributor and the baseline shop');
  assert.equal(res.body.totals.collected, '0.00');
  assert.equal(res.body.totals.outstanding, '0.00');
});

test('marking an invoice paid is a claim: a second attempt is a 409, not a second payment', async () => {
  await world();
  const shop = await makePartner();
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const invoice = await prisma.subscriptionInvoice.findFirst();

  const first = await request(app)
    .post(`/api/master/billing/invoices/${invoice.id}/mark-paid`)
    .set(auth(master))
    .send({ reference: 'UTR123456' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.invoice.status, 'PAID');
  assert.equal(first.body.invoice.paidVia, 'MANUAL');
  assert.equal(first.body.invoice.paymentRef, 'UTR123456');

  const second = await request(app)
    .post(`/api/master/billing/invoices/${invoice.id}/mark-paid`)
    .set(auth(master))
    .send({ reference: 'UTR999999' });
  assert.equal(second.status, 409);
  assert.equal(second.body.reason, 'INVOICE_PAID');

  const reread = await prisma.subscriptionInvoice.findUnique({ where: { id: invoice.id } });
  assert.equal(reread.paymentRef, 'UTR123456', 'the first payment is the one on record');
});

test('a payment with no reference is refused — it could never be reconciled', async () => {
  await world();
  await makePartner();
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const invoice = await prisma.subscriptionInvoice.findFirst();

  const res = await request(app)
    .post(`/api/master/billing/invoices/${invoice.id}/mark-paid`)
    .set(auth(master))
    .send({});
  assert.equal(res.status, 400);
});

test('voiding needs a reason, and a paid invoice cannot be voided', async () => {
  await world();
  await makePartner();
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const invoice = await prisma.subscriptionInvoice.findFirst();

  assert.equal(
    (await request(app).post(`/api/master/billing/invoices/${invoice.id}/void`).set(auth(master)).send({})).status,
    400
  );

  const voided = await request(app)
    .post(`/api/master/billing/invoices/${invoice.id}/void`)
    .set(auth(master))
    .send({ note: 'billed in error' });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.invoice.status, 'VOID');

  const paid = await request(app)
    .post(`/api/master/billing/invoices/${invoice.id}/mark-paid`)
    .set(auth(master))
    .send({ reference: 'UTR1' });
  assert.equal(paid.status, 409, 'a voided invoice is not payable');
});

// --- the webhook -------------------------------------------------------------

const signed = (body) => {
  const raw = JSON.stringify(body);
  return {
    raw,
    signature: crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(raw)
      .digest('hex')
  };
};

test('payment_link.paid marks the invoice paid, once, and a retry is a no-op', async (t) => {
  await world();
  const shop = await makePartner();
  await runBilling({ now: new Date('2026-04-16T00:00:00Z') });
  const invoice = await prisma.subscriptionInvoice.findFirst();
  await request(app).post(`/api/billing/invoices/${invoice.id}/pay-link`).set(auth(shop));
  const withLink = await prisma.subscriptionInvoice.findUnique({ where: { id: invoice.id } });

  // The signature is the authentication, so the test needs a secret set. The
  // absence of one in .env.test is deliberate everywhere else in the suite.
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
  t.after(() => { delete process.env.RAZORPAY_WEBHOOK_SECRET; });

  const body = {
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: withLink.paymentLinkId, status: 'paid' } },
      payment: { entity: { id: 'pay_TEST123' } }
    }
  };
  const { raw, signature } = signed(body);

  const first = await request(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .send(raw);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'ok');

  const paidRow = await prisma.subscriptionInvoice.findUnique({ where: { id: invoice.id } });
  assert.equal(paidRow.status, 'PAID');
  assert.equal(paidRow.paidVia, 'RAZORPAY_LINK');
  assert.equal(paidRow.paymentRef, 'pay_TEST123');

  const retry = await request(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .send(raw);
  assert.equal(retry.body.status, 'ignored', 'a Razorpay retry claims nothing');
});

test('an unsigned payment_link webhook is refused before any database read', async () => {
  await world();
  const res = await request(app)
    .post('/api/payments/razorpay/webhook')
    .send({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_x' } } } });
  assert.equal(res.status, 400);
});

// --- the District dashboard's fee rows are real now --------------------------

test('District revenue counts paid invoices, and keeps the projection separate', async () => {
  await world();
  const district = await prisma.user.create({
    data: {
      email: `district-${crypto.randomUUID()}@test.roadmate`,
      password: 'x', name: 'District', role: 'DISTRICT', isActive: true,
      districtName: 'Hyderabad', industryId: industry.id
    }
  });
  const shop = await makePartner();
  await prisma.user.update({ where: { id: shop.id }, data: { districtName: 'Hyderabad' } });
  await runBilling({ now: new Date('2026-05-16T00:00:00Z') }); // two invoices, ₹6,000

  const before = await request(app).get('/api/district/revenue?period=all').set(auth(district));
  const shopsRow = before.body.rows.find((r) => r.key === 'shops');
  assert.equal(shopsRow.basis, 'BILLED', 'no longer UNBILLED_FEE');
  assert.equal(shopsRow.totalCollected, 0, 'invoiced is not collected');
  assert.equal(shopsRow.outstanding, 6000);
  assert.equal(shopsRow.projectedCollected, 3000, 'fee × 1 active shop');

  const invoice = await prisma.subscriptionInvoice.findFirst();
  await request(app)
    .post(`/api/master/billing/invoices/${invoice.id}/mark-paid`)
    .set(auth(master))
    .send({ reference: 'UTR7' });

  const after = await request(app).get('/api/district/revenue?period=all').set(auth(district));
  const row = after.body.rows.find((r) => r.key === 'shops');
  assert.equal(row.totalCollected, 3000, 'money that actually arrived');
  assert.equal(row.outstanding, 3000);
  assert.equal(after.body.totals.realisedCollected >= 3000, true);
});
