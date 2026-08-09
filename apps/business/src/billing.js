// What the subscription banner and the subscription screen say, in one place.
//
// Same shape as `src/job.js` in the Rider app and `src/tradeOrder.js` here: the
// server decides the state, this file decides the sentence. `phase` is derived
// server-side from the clock and the invoices and is never stored, so a screen
// must never re-derive it from `trialEndsAt` — the two would disagree the first
// time an invoice went overdue.

/**
 * The banner above a home screen. Returns null when there is nothing worth
 * interrupting anyone about — an ACTIVE partner with nothing owed does not need
 * a strip on their dashboard telling them they are a customer.
 */
export function billingBanner(billing) {
  if (!billing || billing.billable === false) return null;

  if (!billing.trialStartKnown) {
    // Real, and somebody's job: this partner has no approval date, so nothing
    // can be billed and nobody knows when their trial ended. Silence here is
    // how it stays that way.
    return {
      tone: 'info',
      message: 'Your subscription start date is not on file. RoadMate will be in touch — nothing is owed today.'
    };
  }

  if (billing.phase === 'PAST_DUE') {
    const n = billing.overdueCount;
    return {
      tone: 'danger',
      message: `${n === 1 ? 'An invoice is' : `${n} invoices are`} overdue — ₹${billing.amountDue} outstanding.`,
      action: 'Pay'
    };
  }

  if (billing.phase === 'CANCELLED') {
    return {
      tone: 'warning',
      message: Number(billing.amountDue) > 0
        ? `Your subscription is cancelled. ₹${billing.amountDue} is still outstanding.`
        : 'Your subscription is cancelled.',
      action: 'View'
    };
  }

  if (billing.phase === 'TRIAL') {
    const days = billing.trialDaysLeft;
    // Only in the last month, and louder in the last week. A "you have 89 days
    // free" strip on day one is an advert, and it trains people to ignore the
    // strip that will matter on day 83.
    if (days > 30) return null;
    return {
      tone: days <= 7 ? 'warning' : 'info',
      message: days <= 0
        ? 'Your free trial ends today.'
        : `Free trial: ${days} day${days === 1 ? '' : 's'} left${
            billing.feeConfigured ? `, then ₹${billing.monthlyFee}/month.` : '.'
          }`,
      action: 'Details'
    };
  }

  if (Number(billing.amountDue) > 0) {
    return { tone: 'warning', message: `₹${billing.amountDue} due.`, action: 'Pay' };
  }

  return null;
}

/** The heading on the subscription screen itself. */
export const PHASE_LABEL = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment overdue',
  CANCELLED: 'Cancelled',
  NONE: 'Not applicable'
};

export const PHASE_TONE = {
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'danger',
  CANCELLED: 'neutral',
  NONE: 'neutral'
};

export const INVOICE_TONE = {
  DUE: 'warning',
  PAID: 'success',
  VOID: 'neutral'
};

/** "15 Apr 2026" — invoices are read by people, not parsed. */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One invoice's period, as a person would say it. */
export const invoicePeriod = (invoice) =>
  `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`;
