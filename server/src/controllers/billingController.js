// Partner subscriptions, from both sides of the desk (HANDOFF §7ter).
//
//   · `GET /api/billing/me`                     — the partner's own trial and bills
//   · `POST /api/billing/invoices/:id/pay-link` — the partner asks for a way to pay
//   · `GET /api/master/billing`                 — every partner, MASTER only
//   · `POST /api/master/billing/invoices/:id/mark-paid`
//   · `POST /api/master/billing/invoices/:id/void`
//   · `POST /api/master/billing/partners/:userId/cancel`
//
// Nothing here computes a fee or a date: `src/lib/subscription.js` owns both,
// and these functions parse input and shape JSON, exactly like the customer
// controllers do. Money is a Decimal in the database and a fixed-2 **string**
// on the wire (`publicInvoice`), like every other B2C amount.
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { createPaymentLink } from '../lib/razorpay.js';
import {
  BILLABLE_ROLES,
  isBillableRole,
  ensureSubscription,
  monthlyFeeFor,
  publicSubscription,
  publicInvoice
} from '../lib/subscription.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const invoiceOrder = { orderBy: { periodStart: 'desc' } };

/**
 * GET /api/billing/me
 *
 * The app's trial banner and the partner's own invoice list. Answers for any
 * signed-in staff user: a REGIONAL partner or a rider is not billed at all, and
 * `billable: false` is a better answer than a 403 for a screen that is deciding
 * whether to render anything.
 */
export const getMyBilling = async (req, res) => {
  try {
    if (!isBillableRole(req.user.role)) {
      return res.status(200).json({ status: 'success', billable: false, phase: 'NONE' });
    }

    // Re-read rather than trust the session: `protect` selects a deliberately
    // narrow set of columns and `approvedAt` is not among them. Widening the
    // session for one screen would put an extra column on every request in the
    // platform; this is one query on one route.
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Lazily created, so a partner approved before this feature existed still
    // gets a subscription dated from the approval that actually happened.
    const subscription = await ensureSubscription(user);
    const invoices = subscription
      ? await prisma.subscriptionInvoice.findMany({ where: { subscriptionId: subscription.id }, ...invoiceOrder })
      : [];
    const fee = await monthlyFeeFor(user);

    return res.status(200).json({
      status: 'success',
      billable: true,
      ...publicSubscription({ subscription, invoices, fee })
    });
  } catch (error) {
    console.error('Get My Billing Error:', error);
    return res.status(500).json({ message: 'Server error loading your subscription.' });
  }
};

/**
 * POST /api/billing/invoices/:invoiceId/pay-link
 *
 * The partner asks for a way to pay their own invoice.
 *
 * **Idempotent, and that is load-bearing**: a second link for one invoice is a
 * second way to pay it, and two payments for one month is a refund
 * conversation. So an invoice that already has a link returns that link.
 */
export const createInvoicePaymentLink = async (req, res) => {
  try {
    const invoiceId = parseId(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ message: 'Invalid invoice id.' });

    const invoice = await prisma.subscriptionInvoice.findFirst({
      // Scoped to the caller's own subscription — an invoice id is a small
      // integer and guessing one must not hand over somebody else's bill.
      where: { id: invoiceId, subscription: { userId: req.user.id } },
      include: { subscription: { include: { user: true } } }
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    if (invoice.status !== 'DUE') {
      return res.status(409).json({ message: 'This invoice is not payable.', reason: `INVOICE_${invoice.status}` });
    }

    if (invoice.paymentLinkUrl) {
      return res.status(200).json({ status: 'success', invoice: publicInvoice(invoice), reused: true });
    }

    const partner = invoice.subscription.user;
    const link = await createPaymentLink({
      amountPaise: new Prisma.Decimal(invoice.amount).times(100).toNumber(),
      reference: invoice.number,
      description: `RoadMate subscription — ${invoice.periodStart.toISOString().slice(0, 10)}`,
      customer: { name: partner.businessName || partner.name, phone: partner.phone, email: partner.email }
    });

    const updated = await prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { paymentLinkId: link.id, paymentLinkUrl: link.short_url ?? null }
    });

    return res.status(201).json({
      status: 'success',
      invoice: publicInvoice(updated),
      // The seam is visible rather than hidden: without Razorpay credentials
      // this is a stub URL nobody can pay, and a screen that says so is better
      // than one that sends a partner to a dead link.
      live: !link.stub
    });
  } catch (error) {
    console.error('Create Payment Link Error:', error);
    return res.status(500).json({ message: 'Server error creating the payment link.' });
  }
};

/**
 * GET /api/master/billing — every billable partner and where they stand.
 *
 * This is the screen §7bis.1 has been waiting for: the District dashboard's
 * subscription rows have been labelled "NOT BILLED" since 2026-08-07 because
 * nothing could bill them. What is listed here is real invoices.
 */
export const listBilling = async (req, res) => {
  try {
    const now = new Date();
    const users = await prisma.user.findMany({
      where: { role: { in: Object.keys(BILLABLE_ROLES) }, isActive: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      include: { subscription: { include: { invoices: invoiceOrder } } }
    });

    const partners = [];
    let dueTotal = new Prisma.Decimal(0);
    let paidTotal = new Prisma.Decimal(0);

    for (const user of users) {
      // Created on sight, same as `/api/billing/me` — otherwise a partner who
      // has never opened the app reads as "trial start unknown" here, which is
      // a real problem and would be hiding behind a fake one.
      const subscription = user.subscription ?? (await ensureSubscription(user, { now }));
      const invoices = user.subscription?.invoices ?? [];
      const fee = await monthlyFeeFor(user);
      const row = publicSubscription({ user, subscription, invoices, fee, now });
      partners.push(row);

      for (const inv of invoices) {
        if (inv.status === 'DUE') dueTotal = dueTotal.plus(inv.amount);
        if (inv.status === 'PAID') paidTotal = paidTotal.plus(inv.amount);
      }
    }

    const count = (phase) => partners.filter((p) => p.phase === phase).length;

    return res.status(200).json({
      status: 'success',
      partners,
      totals: {
        // Collected is money that arrived. Outstanding is money invoiced and
        // not yet paid. Neither is the projection the District dashboard shows,
        // and the two must never be added together into one "revenue" figure.
        collected: paidTotal.toFixed(2),
        outstanding: dueTotal.toFixed(2),
        partnerCount: partners.length,
        onTrial: count('TRIAL'),
        active: count('ACTIVE'),
        pastDue: count('PAST_DUE'),
        cancelled: count('CANCELLED'),
        // Two silent ways a partner is not being billed. Both are somebody's
        // job to fix, and neither looks like a problem from any other screen.
        feeNotSet: partners.filter((p) => !p.feeConfigured).length,
        trialStartUnknown: partners.filter((p) => !p.trialStartKnown).length
      }
    });
  } catch (error) {
    console.error('List Billing Error:', error);
    return res.status(500).json({ message: 'Server error loading subscriptions.' });
  }
};

/**
 * POST /api/master/billing/invoices/:invoiceId/mark-paid
 *
 * A bank transfer, a cheque, cash at the office. §7ter's model is a manual
 * invoice, so money arriving outside Razorpay is the expected case rather than
 * an edge — and this is the only way it gets recorded.
 *
 * A conditional `updateMany` on `status = DUE`, so a double tap, or this
 * racing the payment-link webhook, records exactly one payment.
 */
export const markInvoicePaid = async (req, res) => {
  try {
    const invoiceId = parseId(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ message: 'Invalid invoice id.' });

    const reference = String(req.body?.reference ?? '').trim();
    if (!reference) {
      // A payment with no reference cannot be reconciled against a bank
      // statement later, which is the entire point of recording it.
      return res.status(400).json({ message: 'A payment reference (UTR, cheque number) is required.' });
    }

    const claimed = await prisma.subscriptionInvoice.updateMany({
      where: { id: invoiceId, status: 'DUE' },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidVia: 'MANUAL',
        paymentRef: reference,
        markedPaidById: req.user.id
      }
    });

    if (claimed.count !== 1) {
      const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
      return res.status(409).json({
        message: `This invoice is already ${invoice.status.toLowerCase()}.`,
        reason: `INVOICE_${invoice.status}`
      });
    }

    const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    return res.status(200).json({ status: 'success', invoice: publicInvoice(invoice) });
  } catch (error) {
    console.error('Mark Invoice Paid Error:', error);
    return res.status(500).json({ message: 'Server error recording the payment.' });
  }
};

/**
 * POST /api/master/billing/invoices/:invoiceId/void
 *
 * Written off, billed in error, or a month the client agreed to waive. Voiding
 * rather than deleting: an invoice that was issued was seen by a partner, and
 * the record of *why* it is no longer owed is the useful part.
 */
export const voidInvoice = async (req, res) => {
  try {
    const invoiceId = parseId(req.params.invoiceId);
    if (!invoiceId) return res.status(400).json({ message: 'Invalid invoice id.' });

    const note = String(req.body?.note ?? '').trim();
    if (!note) return res.status(400).json({ message: 'A reason is required to void an invoice.' });

    const claimed = await prisma.subscriptionInvoice.updateMany({
      where: { id: invoiceId, status: 'DUE' },
      data: { status: 'VOID', voidedAt: new Date(), voidNote: note }
    });

    if (claimed.count !== 1) {
      const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
      // A paid invoice is refunded, not voided — and there is no refund flow
      // for subscriptions, on purpose. Inventing one here would put a money
      // movement behind a button labelled "void".
      return res.status(409).json({
        message: `Only an unpaid invoice can be voided; this one is ${invoice.status.toLowerCase()}.`,
        reason: `INVOICE_${invoice.status}`
      });
    }

    const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    return res.status(200).json({ status: 'success', invoice: publicInvoice(invoice) });
  } catch (error) {
    console.error('Void Invoice Error:', error);
    return res.status(500).json({ message: 'Server error voiding the invoice.' });
  }
};

/**
 * POST /api/master/billing/partners/:userId/cancel
 *
 * Stops future invoices from `now`. Invoices already issued stay owed — a
 * partner who leaves still owes the month they used, and clearing that is a
 * separate, deliberate `void` with a reason on it.
 */
export const cancelSubscription = async (req, res) => {
  try {
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ message: 'Invalid partner id.' });

    const subscription = await prisma.partnerSubscription.findUnique({
      where: { userId },
      include: { invoices: invoiceOrder, user: true }
    });
    if (!subscription) return res.status(404).json({ message: 'This partner has no subscription.' });
    if (subscription.cancelledAt) {
      return res.status(409).json({ message: 'Already cancelled.', reason: 'ALREADY_CANCELLED' });
    }

    const updated = await prisma.partnerSubscription.update({
      where: { id: subscription.id },
      data: {
        cancelledAt: new Date(),
        cancelNote: String(req.body?.note ?? '').trim() || null
      }
    });

    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: subscription.id },
      ...invoiceOrder
    });
    const fee = await monthlyFeeFor(subscription.user);

    return res.status(200).json({
      status: 'success',
      ...publicSubscription({ user: subscription.user, subscription: updated, invoices, fee })
    });
  } catch (error) {
    console.error('Cancel Subscription Error:', error);
    return res.status(500).json({ message: 'Server error cancelling the subscription.' });
  }
};
