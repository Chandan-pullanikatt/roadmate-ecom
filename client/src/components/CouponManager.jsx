// Coupons — the Master screen (PHASE A.3).
//
// The `Coupon` model has been complete since Phase 0 and `resolveCoupon()` has
// applied it at checkout since §1.4. There was no API and no screen, so a coupon
// could only be inserted by hand with SQL — which means in practice that none
// ever had been, and the entire discount half of the platform was unreachable.
//
// Two things this screen is careful about, both mirroring the server:
//   • `phase` is derived from the clock, never stored, so a coupon reports as
//     expired the instant it expires rather than whenever something last wrote.
//   • Deleting is only offered for a coupon nobody has used. A used coupon is
//     the recorded reason a delivered order was discounted, and that order's
//     money was frozen at delivery. Withdrawing a live offer is the switch.
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Power, Pencil, Ticket } from 'lucide-react';
import Modal from './ui/Modal';
import DataTable from './ui/DataTable';
import Tag from './ui/Tag';
import {
  getCoupons, createCoupon, updateCoupon, deleteCoupon, getIndustries
} from '../utils/api';

const PHASE_TAG = {
  LIVE:      { text: 'Live',      type: 'green' },
  SCHEDULED: { text: 'Scheduled', type: 'blue'  },
  EXPIRED:   { text: 'Expired',   type: 'amber' },
  WITHDRAWN: { text: 'Withdrawn', type: 'red'   }
};

const blankForm = () => ({
  code: '',
  title: '',
  subtitle: '',
  discountType: 'FLAT',
  discountValue: '',
  maxDiscount: '',
  minOrderValue: '',
  usageLimit: '',
  perUserLimit: '1',
  validFrom: '',
  validTo: '',
  industryId: '',
  shopId: '',
  autoApply: false
});

/** ISO → the `datetime-local` shape, in the browser's own timezone. */
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const describe = (c) =>
  c.discountType === 'PERCENT'
    ? `${Number(c.discountValue)}% off${c.maxDiscount ? `, up to ₹${Number(c.maxDiscount)}` : ''}`
    : `₹${Number(c.discountValue)} off`;

export default function CouponManager() {
  const [coupons, setCoupons] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // the coupon being edited, or null
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [couponData, industryData] = await Promise.all([
        getCoupons(),
        getIndustries().catch(() => ({ industries: [] }))
      ]);
      setCoupons(couponData.coupons || []);
      setIndustries(industryData.industries || []);
    } catch (err) {
      console.error('Coupon load error:', err);
      setError('Could not load coupons.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(blankForm());
    setError('');
    setModalOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      code: c.code,
      title: c.title,
      subtitle: c.subtitle ?? '',
      discountType: c.discountType,
      discountValue: c.discountValue ?? '',
      maxDiscount: c.maxDiscount ?? '',
      minOrderValue: c.minOrderValue ?? '',
      usageLimit: c.usageLimit ?? '',
      perUserLimit: String(c.perUserLimit ?? 1),
      validFrom: toLocalInput(c.validFrom),
      validTo: toLocalInput(c.validTo),
      industryId: c.industryId ?? '',
      shopId: c.shopId ?? '',
      autoApply: Boolean(c.autoApply)
    });
    setError('');
    setModalOpen(true);
  };

  const submit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : undefined,
        validTo: form.validTo ? new Date(form.validTo).toISOString() : undefined
      };
      if (editing) await updateCoupon(editing.id, body);
      else await createCoupon(body);
      setModalOpen(false);
      await load();
    } catch (err) {
      // The server names the field. Its message is the useful one — this form
      // deliberately does not re-implement the validation, because two copies
      // is how a rule drifts.
      setError(err?.response?.data?.message || 'Could not save this coupon.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c) => {
    try {
      await updateCoupon(c.id, { isActive: !c.isActive });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not update this coupon.');
    }
  };

  const remove = async (c) => {
    setError('');
    setNotice('');
    try {
      await deleteCoupon(c.id);
      await load();
    } catch (err) {
      // A used coupon comes back 409 COUPON_IN_USE with a message that explains
      // why and what to do instead. Surfaced as guidance, not as a failure.
      setNotice(err?.response?.data?.message || 'Could not delete this coupon.');
    }
  };

  const columns = [
    {
      header: 'Code',
      render: (c) => (
        <div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>
            {c.code}
            {/* An automatic offer's code still works if typed — but nobody has
                to know it, which is a different kind of offer to run. */}
            {c.autoApply && (
              <span style={{
                marginLeft: 6, fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
                letterSpacing: 0.3, color: 'var(--accent)'
              }}>
                AUTO
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.title}</div>
        </div>
      )
    },
    { header: 'Discount', render: (c) => <span style={{ fontSize: 13 }}>{describe(c)}</span> },
    {
      header: 'Minimum',
      render: (c) => (
        <span style={{ fontFamily: 'DM Mono, monospace' }}>
          {Number(c.minOrderValue) > 0 ? `₹${Number(c.minOrderValue)}` : '—'}
        </span>
      )
    },
    {
      header: 'Scope',
      render: (c) => (
        <span style={{ fontSize: 12 }}>
          {c.shop ? c.shop.name : c.industry ? c.industry.name : 'Platform-wide'}
        </span>
      )
    },
    {
      header: 'Used',
      render: (c) => (
        <span style={{ fontFamily: 'DM Mono, monospace' }}>
          {c.timesUsed ?? 0}{c.usageLimit ? ` / ${c.usageLimit}` : ''}
        </span>
      )
    },
    {
      header: 'Window',
      render: (c) => (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(c.validFrom).toLocaleDateString('en-IN')} –{' '}
          {new Date(c.validTo).toLocaleDateString('en-IN')}
        </span>
      )
    },
    {
      header: 'Status',
      render: (c) => {
        const tag = PHASE_TAG[c.phase] || PHASE_TAG.WITHDRAWN;
        return <Tag text={tag.text} type={tag.type} />;
      }
    },
    {
      header: '',
      render: (c) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost" title="Edit" onClick={() => openEdit(c)}>
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-ghost"
            title={c.isActive ? 'Withdraw this offer' : 'Put this offer back'}
            onClick={() => toggleActive(c)}
          >
            <Power size={13} />
          </button>
          {/* Offered only for a coupon nobody has used. On one that has been,
              the server answers 409 and says to switch it off instead — which
              is what the button beside this one does. */}
          {(c.timesUsed ?? 0) === 0 && (
            <button
              className="btn btn-ghost"
              title="Delete"
              onClick={() => remove(c)}
              style={{ color: 'var(--danger, #c0392b)' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )
    }
  ];

  return (
    <>
      <div className="section-header">
        <div>
          <h2 className="section-title">Coupons</h2>
          <p className="section-sub">
            Offers customers can apply at checkout. Codes are also listed in the app,
            so a customer no longer has to be told one to use it.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={12} /> New Coupon
        </button>
      </div>

      {notice && (
        <div className="info-box amber" style={{ marginBottom: 12 }}>{notice}</div>
      )}
      {error && !modalOpen && (
        <div className="info-box" style={{ marginBottom: 12, color: 'var(--danger, #c0392b)' }}>
          {error}
        </div>
      )}

      <div className="card full-col">
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
          ) : coupons.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Ticket size={22} style={{ opacity: 0.5, marginBottom: 8 }} />
              <div>No coupons yet. Nothing is discounted until one exists.</div>
            </div>
          ) : (
            <DataTable columns={columns} data={coupons} />
          )}
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.code}` : 'New Coupon'}
        subtitle="Customers apply this at checkout, and see it in the app's offers list"
        width="720px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Coupon'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              className="form-input" placeholder="SAVE50"
              style={{ fontFamily: 'DM Mono, monospace', textTransform: 'uppercase' }}
              value={form.code}
              onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              3–24 letters and digits. What the customer types.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Title <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              className="form-input" placeholder="Flat ₹50 Off"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              What the customer reads in the offers list.
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Subtitle</label>
          <input
            className="form-input" placeholder="On orders above ₹299"
            value={form.subtitle}
            onChange={e => setForm({ ...form, subtitle: e.target.value })}
          />
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">The discount</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-select"
              value={form.discountType}
              onChange={e => setForm({ ...form, discountType: e.target.value })}
            >
              <option value="FLAT">Flat amount (₹)</option>
              <option value="PERCENT">Percentage (%)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Value <span style={{ color: 'var(--red)' }}>*</span>
            </label>
            <input
              type="number" className="form-input" min="0" step="0.01"
              placeholder={form.discountType === 'PERCENT' ? '10' : '50'}
              value={form.discountValue}
              onChange={e => setForm({ ...form, discountValue: e.target.value })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Maximum Discount (₹)</label>
            <input
              type="number" className="form-input" min="0" step="0.01" placeholder="Blank for no cap"
              value={form.maxDiscount}
              onChange={e => setForm({ ...form, maxDiscount: e.target.value })}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Mostly for percentages — caps what 20% off a large order costs.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Minimum Order Value (₹)</label>
            <input
              type="number" className="form-input" min="0" step="0.01" placeholder="0"
              value={form.minOrderValue}
              onChange={e => setForm({ ...form, minOrderValue: e.target.value })}
            />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">When and how often</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Valid From <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="datetime-local" className="form-input"
              value={form.validFrom}
              onChange={e => setForm({ ...form, validFrom: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Valid To <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="datetime-local" className="form-input"
              value={form.validTo}
              onChange={e => setForm({ ...form, validTo: e.target.value })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Total Uses</label>
            <input
              type="number" className="form-input" min="1" placeholder="Blank for unlimited"
              value={form.usageLimit}
              onChange={e => setForm({ ...form, usageLimit: e.target.value })}
            />
            {/* Blank clears, and is not 0 — the same rule the Platform Settings
                screen enforces. A 0 would be an offer nobody can ever claim. */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Blank means unlimited. It is never stored as zero.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Per Customer</label>
            <input
              type="number" className="form-input" min="1"
              value={form.perUserLimit}
              onChange={e => setForm({ ...form, perUserLimit: e.target.value })}
            />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">How it is reached</h3>
        <label
          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={form.autoApply}
            onChange={e => setForm({ ...form, autoApply: e.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Apply automatically</span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
              The customer does not have to type anything. At checkout the best
              automatic offer that actually qualifies is applied — every limit,
              window and scope above still holds. A code the customer types
              always wins over this.
            </div>
          </span>
        </label>

        <div className="form-divider" />
        <h3 className="form-section-title">Scope</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Industry</label>
            <select
              className="form-select"
              value={form.industryId}
              onChange={e => setForm({ ...form, industryId: e.target.value })}
            >
              <option value="">Any industry</option>
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Shop ID</label>
            <input
              type="number" className="form-input" placeholder="Blank for every shop"
              value={form.shopId}
              onChange={e => setForm({ ...form, shopId: e.target.value })}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              A shop-specific offer is shown only on that shop's page.
            </div>
          </div>
        </div>

        {error && (
          <div className="info-box" style={{ marginTop: 12, color: 'var(--danger, #c0392b)' }}>
            {error}
          </div>
        )}
      </Modal>
    </>
  );
}
