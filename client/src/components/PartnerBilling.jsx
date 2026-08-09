/*
 * Partner Billing — the Master-only screen for subscriptions and invoices.
 * HANDOFF §7ter.
 *
 * WHY THIS EXISTS: the 3-month-free-trial-then-monthly requirement was agreed
 * with the client's manager on 2026-08-07 and nothing implemented it, which is
 * why the District dashboard's subscription rows had to be tagged "NOT BILLED"
 * (§7bis.1) — the platform was quoting fee × headcount for partners it had no
 * way to invoice. This screen is where a fee becomes an invoice and an invoice
 * becomes money.
 *
 * Four things it is careful about:
 *
 *  · **Invoiced is not collected.** "Collected" is paid invoices; "Outstanding"
 *    is invoiced and unpaid. They are never added together, and neither is the
 *    projection the District dashboard shows.
 *  · **Two silent ways a partner is not being billed**, and both are counted at
 *    the top: no fee set for their role, and no approval date on file so their
 *    trial cannot be dated. Neither is visible from any other screen, and a
 *    partner trading for free looks exactly like a partner who paid.
 *  · **Marking paid needs a reference.** A UTR or cheque number, because a
 *    payment nobody can match to a bank statement is not a record of anything.
 *  · **Nothing here charges a card.** §7ter's model is a manual invoice plus a
 *    payment link the partner opens themselves — there are no mandates and no
 *    auto-debit. This screen records money that arrived.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Ban, Check, X } from 'lucide-react';
import {
  getBillingOverview,
  markInvoicePaid,
  voidInvoice,
  cancelPartnerSubscription
} from '../utils/api';
import Tag from './ui/Tag';

/* Money off this API is a fixed-2 string. Format it; never parseFloat it. */
const rupees = (value) => {
  const n = Number(value ?? 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const shortDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
};

const PHASE = {
  TRIAL: { label: 'Free trial', type: 'blue' },
  ACTIVE: { label: 'Active', type: 'green' },
  PAST_DUE: { label: 'Overdue', type: 'red' },
  CANCELLED: { label: 'Cancelled', type: 'gray' },
  NONE: { label: '—', type: 'gray' }
};

const INVOICE = {
  DUE: { label: 'Unpaid', type: 'amber' },
  PAID: { label: 'Paid', type: 'green' },
  VOID: { label: 'Void', type: 'gray' }
};

const FILTERS = [
  { key: 'all', label: 'All partners' },
  { key: 'PAST_DUE', label: 'Overdue' },
  { key: 'TRIAL', label: 'On trial' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'unbillable', label: 'Not billable' }
];

export default function PartnerBilling() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getBillingOverview());
      setError('');
    } catch {
      setError('Could not load subscriptions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totals = data?.totals ?? {};
  const partners = useMemo(() => {
    const list = data?.partners ?? [];
    if (filter === 'all') return list;
    // "Not billable" is the union of the two silent failures — a partner nobody
    // can invoice, for either reason. It is the only filter that is a problem
    // rather than a state.
    if (filter === 'unbillable') return list.filter((p) => !p.feeConfigured || !p.trialStartKnown);
    return list.filter((p) => p.phase === filter);
  }, [data, filter]);

  /* Every mutation reloads: these figures are sums over invoices and a partial
     local update is how a screen starts disagreeing with the ledger. */
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const onMarkPaid = (invoice) => {
    const reference = window.prompt(
      `Payment reference for ${invoice.number} (${rupees(invoice.amount)}) — UTR, cheque number or receipt id:`
    );
    if (!reference || !reference.trim()) return;
    run(() => markInvoicePaid(invoice.id, reference.trim()));
  };

  const onVoid = (invoice) => {
    const note = window.prompt(`Why is ${invoice.number} being written off? This is kept on the record:`);
    if (!note || !note.trim()) return;
    run(() => voidInvoice(invoice.id, note.trim()));
  };

  const onCancel = (partner) => {
    if (!window.confirm(
      `Cancel ${partner.partner?.name}'s subscription? No new invoices will be raised. Anything already invoiced stays owed.`
    )) return;
    const note = window.prompt('Reason (optional):') ?? '';
    run(() => cancelPartnerSubscription(partner.partner.id, note.trim()));
  };

  if (loading) return <div className="card full-col"><div className="card-body">Loading subscriptions…</div></div>;

  return (
    <div className="full-col" style={{ display: 'grid', gap: '16px' }}>
      {error ? (
        <div className="card" style={{ borderColor: 'var(--red)' }}>
          <div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertTriangle size={16} color="var(--red)" />
            <span>{error}</span>
            <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setError('')}>
              <X size={12} /> Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Collected and outstanding are deliberately two figures. One is money
          in the bank, the other is money owed, and a single "revenue" number
          made of both is exactly the mistake §7bis.1 was about. */}
      <div className="stat-grid">
        <Stat label="Collected" value={rupees(totals.collected)} tone="green"
              hint="Invoices actually paid" />
        <Stat label="Outstanding" value={rupees(totals.outstanding)} tone="amber"
              hint="Invoiced and not yet paid" />
        <Stat label="On free trial" value={totals.onTrial ?? 0}
              hint="Not billed yet, by design" />
        <Stat label="Overdue" value={totals.pastDue ?? 0} tone={totals.pastDue ? 'red' : undefined}
              hint="Past the payment terms" />
      </div>

      {(totals.feeNotSet > 0 || totals.trialStartUnknown > 0) ? (
        <div className="card" style={{ borderLeft: '3px solid var(--amber)' }}>
          <div className="card-body" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color="var(--amber)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: '13px', lineHeight: 1.6 }}>
              <strong>Some partners cannot be invoiced.</strong>
              {totals.feeNotSet > 0 ? (
                <div>
                  {totals.feeNotSet} {totals.feeNotSet === 1 ? 'partner has' : 'partners have'} no monthly fee set
                  for their role. They are trading and not being billed — set the fee under{' '}
                  <strong>Platform → Settings</strong>. A blank fee is not a free one.
                </div>
              ) : null}
              {totals.trialStartUnknown > 0 ? (
                <div>
                  {totals.trialStartUnknown}{' '}
                  {totals.trialStartUnknown === 1 ? 'partner has' : 'partners have'} no approval date on file, so
                  the free trial cannot be dated and nothing is billed. These were approved before RoadMate
                  recorded approval dates; the start date has to be decided by a human.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">Partner subscriptions</h2>
            <p className="section-sub">
              {totals.partnerCount ?? 0} billable partners · 3-month free trial from approval, then monthly
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <button className="btn btn-outline btn-sm" onClick={load} disabled={busy}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Standing</th>
                <th className="hide-mobile">Trial ends</th>
                <th style={{ textAlign: 'right' }}>Monthly</th>
                <th style={{ textAlign: 'right' }}>Owed</th>
                <th style={{ textAlign: 'right' }} className="hide-mobile">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No partners in this view.
                  </td>
                </tr>
              ) : (
                partners.map((p) => {
                  const phase = PHASE[p.phase] ?? PHASE.NONE;
                  const isOpen = openId === p.partner?.id;
                  return (
                    <React.Fragment key={p.partner?.id}>
                      <tr
                        onClick={() => setOpenId(isOpen ? null : p.partner?.id)}
                        style={{ cursor: 'pointer' }}
                        title="Show invoices"
                      >
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.partner?.businessName || p.partner?.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {p.partner?.role} · {p.partner?.name}
                          </div>
                        </td>
                        <td>
                          <Tag text={phase.label} type={phase.type} />
                          {!p.trialStartKnown ? <Tag text="NO START DATE" type="amber" /> : null}
                          {!p.feeConfigured ? <Tag text="NO FEE" type="amber" /> : null}
                        </td>
                        <td className="mono hide-mobile">{shortDate(p.trialEndsAt)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          {/* Unset renders "—", never ₹0: nobody has decided is
                              a different claim from somebody decided it is free. */}
                          {p.feeConfigured ? rupees(p.monthlyFee) : '—'}
                        </td>
                        <td className="mono" style={{
                          textAlign: 'right', fontWeight: 600,
                          color: Number(p.amountDue) > 0 ? 'var(--amber)' : 'var(--text-muted)'
                        }}>
                          {rupees(p.amountDue)}
                        </td>
                        <td className="mono hide-mobile" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                          {p.invoices.length}
                        </td>
                      </tr>

                      {isOpen ? (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--bg-subtle, #FAFAFA)', padding: '12px 16px' }}>
                            <InvoiceList
                              partner={p}
                              busy={busy}
                              onMarkPaid={onMarkPaid}
                              onVoid={onVoid}
                              onCancel={onCancel}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border)',
          fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6
        }}>
          Invoices are raised by <code>npm run billing</code> on the server, once a partner's free trial ends.
          Payments arrive either through the partner's own Razorpay payment link or by bank transfer, which is
          recorded here. Nothing is charged automatically — there are no auto-debit mandates.
        </div>
      </div>
    </div>
  );
}

function InvoiceList({ partner, busy, onMarkPaid, onVoid, onCancel }) {
  if (!partner.invoices.length) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {partner.phase === 'TRIAL'
            ? `No invoices yet — the free trial runs to ${shortDate(partner.trialEndsAt)}.`
            : 'No invoices yet.'}
        </span>
        {partner.phase !== 'CANCELLED' && partner.trialStartKnown ? (
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onCancel(partner)}>
            <Ban size={12} /> Cancel subscription
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {partner.invoices.map((inv) => {
        const badge = INVOICE[inv.status] ?? INVOICE.DUE;
        return (
          <div
            key={inv.id}
            style={{
              display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
              padding: '8px 10px', background: 'var(--card, #FFF)',
              border: '1px solid var(--border)', borderRadius: 8, fontSize: '13px'
            }}
          >
            <div style={{ minWidth: 190 }}>
              <div style={{ fontWeight: 600 }} className="mono">{inv.number}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {shortDate(inv.periodStart)} – {shortDate(inv.periodEnd)}
              </div>
            </div>
            <div className="mono" style={{ fontWeight: 700, minWidth: 90 }}>{rupees(inv.amount)}</div>
            <Tag text={badge.label} type={badge.type} />
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', flex: 1 }}>
              {inv.status === 'PAID'
                ? `Paid ${shortDate(inv.paidAt)} · ${inv.paidVia === 'MANUAL' ? 'bank/manual' : 'payment link'}${
                    inv.paymentRef ? ` · ${inv.paymentRef}` : ''
                  }`
                : inv.status === 'VOID'
                  ? `Voided ${shortDate(inv.voidedAt)}${inv.voidNote ? ` · ${inv.voidNote}` : ''}`
                  : `Due ${shortDate(inv.dueAt)}`}
            </div>
            {inv.status === 'DUE' ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onMarkPaid(inv)}>
                  <Check size={12} /> Mark paid
                </button>
                <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onVoid(inv)}>
                  Void
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      {partner.phase !== 'CANCELLED' ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onCancel(partner)}>
            <Ban size={12} /> Cancel subscription
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, tone }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : undefined;
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono" style={{ color }}>{value}</div>
      {hint ? <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{hint}</div> : null}
    </div>
  );
}
