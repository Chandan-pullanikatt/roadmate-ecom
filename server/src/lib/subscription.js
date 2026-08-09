// Partner subscriptions — the 3-month free trial and the monthly invoice.
// HANDOFF §7ter, agreed 2026-08-07 with the client's manager and unbuilt until
// 2026-08-09. This file is the *only* place a trial date, a billing period or
// an invoice amount is decided; controllers and the job read it.
//
// Three rules it exists to hold in one place:
//
//   1. **The clock starts at approval.** `User.approvedAt`, never `createdAt` —
//      a partner cannot trade before they are approved, and being billed for
//      the fortnight they spent waiting on somebody else's approval queue is
//      the kind of thing that ends a launch cohort. A partner with no
//      `approvedAt` (every row predating migration 20260807090000) gets **no
//      subscription at all**, and is reported as such. Inventing an approval
//      date here would silently decide when a real business starts paying.
//
//   2. **The fee is frozen at issue.** `subscription_fee_shop` is a config row
//      the client edits from the Master settings screen; `SubscriptionInvoice
//      .amount` is a Decimal column written once. This is the same discipline
//      as `applyCommissionSplit()` and `computeRiderEarning()`, for the same
//      reason — changing a price next month must not rewrite last month's bill.
//
//   3. **An unset fee is not a free one.** `subscription_fee_manufacturer` has
//      no value and no default on purpose (HANDOFF §7.1). A partner on that fee
//      is **skipped**, loudly, and never invoiced ₹0 — because ₹0 is a bill
//      that says the platform decided they owe nothing.
//
// ⚠️ There is no auto-debit and no mandate. The client's answer is a manual
// monthly invoice plus a Razorpay payment link (§7ter), which is why nothing
// here ever moves money on its own: the job *issues* invoices, and a human or a
// webhook marks them paid.
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';

/**
 * Which roles are billed, and what each one's fee is called.
 *
 * REGIONAL and above are deliberately absent: those partners are *paid* a share
 * of the commission pool, not billed a subscription. So are riders — a platform
 * pays its delivery partners per delivery (HANDOFF §3), which is exactly why
 * the ₹2,000/month rider subscription was deleted rather than relabelled.
 * Adding a role here is the whole of "bill a new kind of partner".
 */
export const BILLABLE_ROLES = {
  SHOP: CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP,
  DISTRIBUTOR: CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR,
  MANUFACTURER: CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER
};

export const isBillableRole = (role) => Object.hasOwn(BILLABLE_ROLES, role);

/**
 * `date` plus `n` calendar months, clamped to the end of the target month.
 *
 * The clamp is the point: a shop approved on the 31st has periods starting on
 * the 28th of February, not the 3rd of March. Date-arithmetic that overflows
 * would silently skip a month boundary and issue two invoices in one month.
 */
export function addMonths(date, n) {
  const d = new Date(date.getTime());
  const targetMonth = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(targetMonth);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTarget));
  return d;
}

const addDays = (date, n) => new Date(date.getTime() + n * 86_400_000);

/** The monthly fee for this partner, or null when nobody has set one. */
export async function monthlyFeeFor(user) {
  const key = BILLABLE_ROLES[user.role];
  if (!key) return null;
  const value = await getConfigNumber(key, user.industryId ?? null);
  return Number.isFinite(value) ? value : null;
}

/**
 * The subscription row for a partner, created on first sight.
 *
 * Lazy rather than backfilled, and called from both `approvePartner` (so every
 * partner approved from now on has one immediately) and the billing job (so a
 * partner approved before this feature existed still gets one, dated from the
 * approval that actually happened). Returns null — never a row — when there is
 * no honest date to start the clock from.
 */
export async function ensureSubscription(user, { now = new Date() } = {}) {
  if (!isBillableRole(user.role)) return null;

  const existing = await prisma.partnerSubscription.findUnique({ where: { userId: user.id } });
  if (existing) return existing;

  // No approval date, no trial start. Reported as `trialStartUnknown` by the
  // API rather than guessed at — see the file header.
  if (!user.approvedAt) return null;

  const trialMonths = await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_TRIAL_MONTHS);
  const trialStartedAt = new Date(user.approvedAt);
  const trialEndsAt = addMonths(trialStartedAt, trialMonths);

  try {
    return await prisma.partnerSubscription.create({
      data: {
        userId: user.id,
        trialStartedAt,
        trialEndsAt,
        // Equal to `trialEndsAt` on every row this code creates. Separate so an
        // extended trial is a column edit rather than a lie about when the
        // trial ended.
        billingAnchorAt: trialEndsAt
      }
    });
  } catch (err) {
    // `userId` is unique: two callers racing (an approval and the billing job)
    // is a normal outcome, not an error. Whoever lost simply reads the winner's
    // row — the same shape as every other claim in this codebase.
    if (err?.code === 'P2002') {
      return prisma.partnerSubscription.findUnique({ where: { userId: user.id } });
    }
    throw err;
  }
}

/**
 * What state an account is in, derived and never stored.
 *
 * A stored status is a second copy of the clock, and it goes stale the moment a
 * scheduled job fails to run — leaving a partner the database *says* is in good
 * standing. `invoices` is the partner's own invoice list; pass it loaded.
 */
export function subscriptionPhase(sub, invoices = [], now = new Date()) {
  if (!sub) return 'NONE';
  if (sub.cancelledAt && sub.cancelledAt <= now) return 'CANCELLED';
  if (invoices.some((i) => i.status === 'DUE' && i.dueAt < now)) return 'PAST_DUE';
  if (now < sub.trialEndsAt) return 'TRIAL';
  return 'ACTIVE';
}

/** Whole days from `now` to `date`, rounded up. Negative once `date` has passed. */
export function daysUntil(date, now = new Date()) {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Every monthly period that has *started* by `now` and is not yet invoiced.
 *
 * Billing is in advance — a period is invoiced when it begins, with payment
 * terms of `subscription_invoice_due_days`. Walking forward from the anchor
 * rather than looking only at "this month" is what makes a missed run
 * self-healing: three months of downtime produces the three invoices that were
 * owed, in order, with their real period dates on them.
 */
export function periodsToInvoice(sub, now = new Date(), { max = 60 } = {}) {
  const periods = [];
  const stopAt = sub.cancelledAt && sub.cancelledAt < now ? sub.cancelledAt : now;

  for (let i = 0; i < max; i += 1) {
    const periodStart = addMonths(sub.billingAnchorAt, i);
    if (periodStart > stopAt) break;
    periods.push({ periodStart, periodEnd: addMonths(sub.billingAnchorAt, i + 1) });
  }
  return periods;
}

/**
 * Human-quotable and deterministic, so it can be pasted into a bank narration
 * and so a re-run cannot mint a second number for one period.
 */
export const invoiceNumberFor = (userId, periodStart) => {
  const y = periodStart.getUTCFullYear();
  const m = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
  return `RM-SUB-${y}${m}-${String(userId).padStart(5, '0')}`;
};

/**
 * Issue whatever this partner owes and has not been billed for.
 *
 * Returns `{ issued, skipped }` — `skipped` carries a reason, because the two
 * ways to issue nothing mean completely different things to whoever reads the
 * job's output: `TRIAL` is working as designed, `FEE_NOT_SET` is a partner
 * nobody can bill.
 */
export async function issueInvoicesFor(user, { now = new Date() } = {}) {
  const sub = await ensureSubscription(user, { now });
  if (!sub) return { issued: [], skipped: 'NO_APPROVAL_DATE' };
  if (sub.cancelledAt && sub.cancelledAt <= sub.billingAnchorAt) return { issued: [], skipped: 'CANCELLED' };

  const periods = periodsToInvoice(sub, now);
  if (periods.length === 0) return { issued: [], skipped: 'TRIAL' };

  // Read once, outside the loop: a backfill of three missed months is three
  // invoices at today's price, which is the only price anybody ever agreed.
  // (Retro-pricing a missed month would need a price history nobody keeps.)
  const fee = await monthlyFeeFor(user);
  if (fee === null) return { issued: [], skipped: 'FEE_NOT_SET' };

  const dueDays = await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_INVOICE_DUE_DAYS);
  const issued = [];

  // Skip the periods already on the books. The unique constraint is still what
  // *guarantees* one invoice per period — this read only stops the common
  // re-run from taking the exception path, which is otherwise a Prisma error
  // logged for every already-billed month every time cron fires.
  const existing = await prisma.subscriptionInvoice.findMany({
    where: { subscriptionId: sub.id },
    select: { periodStart: true }
  });
  const billed = new Set(existing.map((i) => i.periodStart.getTime()));

  for (const { periodStart, periodEnd } of periods) {
    if (billed.has(periodStart.getTime())) continue;

    try {
      const invoice = await prisma.subscriptionInvoice.create({
        data: {
          subscriptionId: sub.id,
          number: invoiceNumberFor(user.id, periodStart),
          periodStart,
          periodEnd,
          amount: new Prisma.Decimal(fee).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          dueAt: addDays(periodStart > now ? periodStart : now, dueDays)
        }
      });
      issued.push(invoice);
    } catch (err) {
      // @@unique([subscriptionId, periodStart]) — this period is already
      // invoiced. That is the mechanism that makes the job re-runnable, so it
      // is an expected outcome and not an error.
      if (err?.code !== 'P2002') throw err;
    }
  }

  return { issued, skipped: issued.length ? null : 'ALREADY_INVOICED' };
}

/**
 * The monthly run — `src/jobs/runBilling.js` calls this. One-shot, like
 * `runSettlement()` and unlike the sweeper; point cron at it daily or monthly,
 * it does not matter which, because it issues what is owed and nothing else.
 *
 * Only `isActive` partners are billed. A deactivated partner is not trading,
 * and billing one is how a platform ends up chasing money from somebody it
 * switched off itself.
 */
export async function runBilling({ now = new Date() } = {}) {
  const users = await prisma.user.findMany({
    where: { role: { in: Object.keys(BILLABLE_ROLES) }, isActive: true },
    orderBy: { id: 'asc' }
  });

  const result = { issued: 0, totalAmount: new Prisma.Decimal(0), skipped: {}, partners: [] };

  for (const user of users) {
    const { issued, skipped } = await issueInvoicesFor(user, { now });
    if (skipped) result.skipped[skipped] = (result.skipped[skipped] ?? 0) + 1;
    for (const invoice of issued) {
      result.issued += 1;
      result.totalAmount = result.totalAmount.plus(invoice.amount);
    }
    if (issued.length) {
      result.partners.push({ userId: user.id, name: user.name, role: user.role, count: issued.length });
    }
  }

  return result;
}

/** Decimal → the fixed-2 string every B2C money field is sent as. */
const money = (d) => new Prisma.Decimal(d ?? 0).toFixed(2);

/** One invoice, as the API sends it. */
export const publicInvoice = (invoice) => ({
  id: invoice.id,
  number: invoice.number,
  periodStart: invoice.periodStart,
  periodEnd: invoice.periodEnd,
  amount: money(invoice.amount),
  status: invoice.status,
  issuedAt: invoice.issuedAt,
  dueAt: invoice.dueAt,
  paidAt: invoice.paidAt,
  paidVia: invoice.paidVia,
  paymentRef: invoice.paymentRef,
  paymentLinkUrl: invoice.paymentLinkUrl,
  voidedAt: invoice.voidedAt,
  voidNote: invoice.voidNote
});

/**
 * A partner's whole billing position, in the shape the app's banner and the
 * Master screen both read. Computed from the row and the clock — nothing here
 * is a stored summary that could disagree with the invoices under it.
 */
export function publicSubscription({ user, subscription, invoices = [], fee = null, now = new Date() }) {
  const phase = subscriptionPhase(subscription, invoices, now);
  const outstanding = invoices.filter((i) => i.status === 'DUE');
  const amountDue = outstanding.reduce((s, i) => s.plus(i.amount), new Prisma.Decimal(0));

  return {
    partner: user
      ? { id: user.id, name: user.name, role: user.role, businessName: user.businessName ?? null }
      : undefined,
    phase,
    // false here is the "approved before we recorded approval dates" case: the
    // trial cannot be dated, so nothing is billed and somebody has to decide.
    trialStartKnown: Boolean(subscription),
    trialStartedAt: subscription?.trialStartedAt ?? null,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    trialDaysLeft: subscription && phase === 'TRIAL' ? daysUntil(subscription.trialEndsAt, now) : 0,
    billingAnchorAt: subscription?.billingAnchorAt ?? null,
    cancelledAt: subscription?.cancelledAt ?? null,
    monthlyFee: fee === null ? null : money(fee),
    // Same distinction the District dashboard already draws: unset renders "—",
    // and it means this partner cannot be invoiced at all, not that they are free.
    feeConfigured: fee !== null,
    amountDue: money(amountDue),
    outstandingCount: outstanding.length,
    overdueCount: outstanding.filter((i) => i.dueAt < now).length,
    invoices: invoices.map(publicInvoice)
  };
}
