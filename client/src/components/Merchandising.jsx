// Banners and collections — the Master screen (PHASE B).
//
// Neither existed in any form before this: no model, no endpoint, no screen. The
// customer home screen was the catalogue sorted by distance, and there was no
// way to put anything in front of anybody.
//
// Two tabs because they are two different promises, and the screen says which:
//   • A BANNER has a validity window and switches itself off. That is why it is
//     a model and not a hardcoded array — nobody has to remember to take the
//     Diwali strip down in January.
//   • A COLLECTION has no money in it at all. It changes what is shown and in
//     what order, and nothing else: no price, no discount, no settlement.
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Power, Pencil, Image as ImageIcon, ListOrdered, GripVertical } from 'lucide-react';
import Modal from './ui/Modal';
import DataTable from './ui/DataTable';
import Tag from './ui/Tag';
import ProductImageUpload from './ProductImageUpload';
import {
  getBanners, createBanner, updateBanner, deleteBanner, signBannerImageUpload,
  getCollections, createCollection, updateCollection, deleteCollection, setCollectionItems,
  getIndustries, getProducts, getCoupons, getActivePartners
} from '../utils/api';

/**
 * The banner palettes, mirrored from `packages/ui/src/tokens.js` so this screen
 * can show what the card will actually look like on a phone.
 *
 * ⚠️ Three copies of one table — the token file, the server's `BANNER_THEMES`
 * whitelist, and this. A web dashboard and a React Native bundle share no code,
 * and the **server** is the one that refuses an unknown key, so a drift here is
 * a preview that lies rather than a banner that breaks. A server test pins the
 * server's list against the token file.
 */
const THEMES = {
  sunrise: { from: '#FEF6D4', to: '#F6DE79', ink: '#1A1A1A', sub: '#5C5326', button: '#1A1A1A', onButton: '#FFFFFF', label: 'Sunrise — the house yellow' },
  mint:    { from: '#E6F8EC', to: '#B3E9C6', ink: '#12331F', sub: '#3D6B4E', button: '#12331F', onButton: '#FFFFFF', label: 'Mint — grocery, fresh' },
  sky:     { from: '#E6F2FE', to: '#BADCF9', ink: '#0F2A44', sub: '#3E617F', button: '#0F2A44', onButton: '#FFFFFF', label: 'Sky — electronics, service' },
  blush:   { from: '#FEEDED', to: '#FBCDD0', ink: '#41161A', sub: '#7A4449', button: '#41161A', onButton: '#FFFFFF', label: 'Blush — food, festival' },
  lilac:   { from: '#F1EBFE', to: '#D5C6FB', ink: '#2A1B4D', sub: '#5A4A80', button: '#2A1B4D', onButton: '#FFFFFF', label: 'Lilac — premium, memberships' },
  ink:     { from: '#2E333B', to: '#14171C', ink: '#FFFFFF', sub: '#B6BDC7', button: '#DEBE10', onButton: '#1A1A1A', label: 'Ink — one high-contrast headline' }
};

/**
 * What the customer will see. Not decoration: a banner is now a **composed
 * card** rather than a flat JPEG, so without a preview the only way to find out
 * whether a headline fits or a colour works is to open the phone.
 */
function BannerPreview({ banner, width = 320 }) {
  const theme = THEMES[banner.theme] ?? THEMES.sunrise;
  return (
    <div
      style={{
        width, minHeight: width * 0.42, borderRadius: 16, overflow: 'hidden',
        background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
        padding: 16, display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 6px 20px rgba(11,18,32,0.14)'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: theme.ink, fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
          {banner.title || 'Your headline here'}
        </div>
        {banner.subtitle && (
          <div style={{ color: theme.sub, fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>
            {banner.subtitle}
          </div>
        )}
        {banner.ctaLabel && (
          <div
            style={{
              display: 'inline-block', marginTop: 10, padding: '6px 14px', borderRadius: 8,
              background: theme.button, color: theme.onButton, fontSize: 11, fontWeight: 700
            }}
          >
            {banner.ctaLabel}
          </div>
        )}
      </div>
      {banner.imageUrl && (
        <img src={banner.imageUrl} alt="" style={{ width: 84, height: 84, objectFit: 'contain' }} />
      )}
    </div>
  );
}

const PHASE_TAG = {
  LIVE:      { text: 'Live',      type: 'green' },
  SCHEDULED: { text: 'Scheduled', type: 'blue'  },
  EXPIRED:   { text: 'Expired',   type: 'amber' },
  WITHDRAWN: { text: 'Withdrawn', type: 'red'   }
};

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const blankBanner = () => ({
  title: '', subtitle: '', imageUrl: null, theme: 'sunrise', ctaLabel: '',
  validFrom: '', validTo: '', sortOrder: '0',
  industryId: '', targetType: 'NONE', targetId: ''
});

const blankCollection = () => ({ title: '', subtitle: '', slug: '', sortOrder: '0', industryId: '', shopId: '' });

export default function Merchandising() {
  const [tab, setTab] = useState('banners');

  // Shared reference data — both tabs need somewhere to point.
  const [industries, setIndustries] = useState([]);
  const [products, setProducts] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [shops, setShops] = useState([]);

  const [banners, setBanners] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [bannerModal, setBannerModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null);
  const [bannerForm, setBannerForm] = useState(blankBanner());

  const [collectionModal, setCollectionModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState(null);
  const [collectionForm, setCollectionForm] = useState(blankCollection());

  const [itemsFor, setItemsFor] = useState(null);   // the collection being curated
  const [picked, setPicked] = useState([]);          // productIds, in order
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [b, c, i, p, cp, partners] = await Promise.all([
        getBanners(),
        getCollections(),
        getIndustries().catch(() => ({ industries: [] })),
        getProducts().catch(() => ({ products: [] })),
        getCoupons().catch(() => ({ coupons: [] })),
        getActivePartners().catch(() => ({ partners: [] }))
      ]);
      setBanners(b.banners || []);
      setCollections(c.collections || []);
      setIndustries(i.industries || []);
      setProducts(p.products || []);
      setCoupons(cp.coupons || []);
      setShops((partners.partners || []).filter((x) => x.role === 'SHOP'));
    } catch (err) {
      console.error('Merchandising load error:', err);
      setError('Could not load banners and collections.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Banners ──────────────────────────────────────────────────────────────

  const openBanner = (b) => {
    setEditingBanner(b || null);
    setError('');
    setBannerForm(
      b
        ? {
            title: b.title, subtitle: b.subtitle ?? '', imageUrl: b.imageUrl,
            theme: b.theme ?? 'sunrise', ctaLabel: b.ctaLabel ?? '',
            validFrom: toLocalInput(b.validFrom), validTo: toLocalInput(b.validTo),
            sortOrder: String(b.sortOrder ?? 0),
            industryId: b.industryId ?? '',
            targetType: b.target?.type ?? 'NONE',
            targetId: b.target?.id ?? ''
          }
        : blankBanner()
    );
    setBannerModal(true);
  };

  const submitBanner = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!bannerForm.title.trim()) {
      setError('A banner needs a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // One target, sent as one field. The server holds three nullable columns
      // and refuses two at once; the form makes two unreachable.
      const target = {
        targetShopId: bannerForm.targetType === 'SHOP' ? bannerForm.targetId : null,
        targetProductId: bannerForm.targetType === 'PRODUCT' ? bannerForm.targetId : null,
        targetCouponId: bannerForm.targetType === 'COUPON' ? bannerForm.targetId : null
      };
      const body = {
        title: bannerForm.title,
        subtitle: bannerForm.subtitle,
        imageUrl: bannerForm.imageUrl,
        theme: bannerForm.theme,
        ctaLabel: bannerForm.ctaLabel,
        validFrom: bannerForm.validFrom ? new Date(bannerForm.validFrom).toISOString() : undefined,
        validTo: bannerForm.validTo ? new Date(bannerForm.validTo).toISOString() : undefined,
        sortOrder: bannerForm.sortOrder,
        industryId: bannerForm.industryId,
        ...target
      };
      if (editingBanner) await updateBanner(editingBanner.id, body);
      else await createBanner(body);
      setBannerModal(false);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save this banner.');
    } finally {
      setSaving(false);
    }
  };

  const bannerColumns = [
    {
      header: '',
      // A swatch of the card's own palette, not `<img src={b.imageUrl}>`: the
      // image is optional now, and a null src renders as a broken-image box.
      render: (b) => {
        const theme = THEMES[b.theme] ?? THEMES.sunrise;
        return (
          <div
            title={theme.label}
            style={{
              width: 64, height: 34, borderRadius: 5, display: 'flex',
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`
            }}
          >
            {b.imageUrl && <img src={b.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
        );
      }
    },
    {
      header: 'Banner',
      render: (b) => (
        <div>
          <div style={{ fontWeight: 500 }}>{b.title}</div>
          {b.subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.subtitle}</div>}
        </div>
      )
    },
    {
      header: 'Opens',
      render: (b) =>
        b.target?.type === 'NONE'
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing — announcement</span>
          : <span style={{ fontSize: 12 }}>{b.target.label || `${b.target.type} #${b.target.id}`}</span>
    },
    {
      header: 'Shows on',
      render: (b) => <span style={{ fontSize: 12 }}>{b.industry ? b.industry.name : 'All industries'}</span>
    },
    {
      header: 'Window',
      render: (b) => (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(b.validFrom).toLocaleDateString('en-IN')} – {new Date(b.validTo).toLocaleDateString('en-IN')}
        </span>
      )
    },
    { header: 'Order', render: (b) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{b.sortOrder}</span> },
    {
      header: 'Status',
      render: (b) => {
        const t = PHASE_TAG[b.phase] || PHASE_TAG.WITHDRAWN;
        return <Tag text={t.text} type={t.type} />;
      }
    },
    {
      header: '',
      render: (b) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost" title="Edit" onClick={() => openBanner(b)}>
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-ghost"
            title={b.isActive ? 'Withdraw' : 'Put back'}
            onClick={async () => { await updateBanner(b.id, { isActive: !b.isActive }); load(); }}
          >
            <Power size={13} />
          </button>
          <button
            className="btn btn-ghost"
            title="Delete"
            style={{ color: 'var(--danger, #c0392b)' }}
            onClick={async () => { await deleteBanner(b.id); load(); }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ];

  // ── Collections ──────────────────────────────────────────────────────────

  const openCollection = (c) => {
    setEditingCollection(c || null);
    setError('');
    setCollectionForm(
      c
        ? {
            title: c.title, subtitle: c.subtitle ?? '', slug: c.slug,
            sortOrder: String(c.sortOrder ?? 0),
            industryId: c.industryId ?? '', shopId: c.shopId ?? ''
          }
        : blankCollection()
    );
    setCollectionModal(true);
  };

  const submitCollection = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingCollection) await updateCollection(editingCollection.id, collectionForm);
      else await createCollection(collectionForm);
      setCollectionModal(false);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save this collection.');
    } finally {
      setSaving(false);
    }
  };

  const openItems = (c) => {
    setItemsFor(c);
    setPicked(c.products.map((p) => p.id));
    setError('');
  };

  const move = (index, delta) => {
    const next = [...picked];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPicked(next);
  };

  const saveItems = async () => {
    setSaving(true);
    setError('');
    try {
      await setCollectionItems(itemsFor.id, picked);
      setItemsFor(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save this list.');
    } finally {
      setSaving(false);
    }
  };

  const collectionColumns = [
    {
      header: 'Collection',
      render: (c) => (
        <div>
          <div style={{ fontWeight: 500 }}>{c.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{c.slug}</div>
        </div>
      )
    },
    {
      header: 'Products',
      render: (c) => (
        <span style={{ fontFamily: 'DM Mono, monospace', color: c.productCount === 0 ? 'var(--text-muted)' : 'inherit' }}>
          {c.productCount}
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
    { header: 'Order', render: (c) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{c.sortOrder}</span> },
    {
      header: 'Status',
      render: (c) =>
        // An empty collection is a heading with nothing under it — the customer
        // endpoint hides it, so say so here rather than letting it look live.
        !c.isActive ? <Tag text="Withdrawn" type="red" />
          : c.productCount === 0 ? <Tag text="Empty — hidden" type="amber" />
          : <Tag text="Live" type="green" />
    },
    {
      header: '',
      render: (c) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost" title="Choose products" onClick={() => openItems(c)}>
            <ListOrdered size={13} />
          </button>
          <button className="btn btn-ghost" title="Edit" onClick={() => openCollection(c)}>
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-ghost"
            title={c.isActive ? 'Withdraw' : 'Put back'}
            onClick={async () => { await updateCollection(c.id, { isActive: !c.isActive }); load(); }}
          >
            <Power size={13} />
          </button>
          <button
            className="btn btn-ghost"
            title="Delete"
            style={{ color: 'var(--danger, #c0392b)' }}
            onClick={async () => { await deleteCollection(c.id); load(); }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ];

  const targetOptions =
    bannerForm.targetType === 'SHOP' ? shops.map((s) => ({ id: s.id, label: s.businessName || s.name }))
      : bannerForm.targetType === 'PRODUCT' ? products.map((p) => ({ id: p.id, label: p.name }))
      : bannerForm.targetType === 'COUPON' ? coupons.map((c) => ({ id: c.id, label: `${c.code} — ${c.title}` }))
      : [];

  return (
    <>
      <div className="section-header">
        <div>
          <h2 className="section-title">Merchandising</h2>
          <p className="section-sub">
            What customers are shown before they search for anything — the home screen's
            banners and its curated lists.
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => (tab === 'banners' ? openBanner(null) : openCollection(null))}
        >
          <Plus size={12} /> {tab === 'banners' ? 'New Banner' : 'New Collection'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[
          { key: 'banners', label: 'Banners', icon: ImageIcon },
          { key: 'collections', label: 'Collections', icon: ListOrdered }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`btn ${tab === key ? 'btn-primary' : 'btn-outline'} btn-sm`}
            onClick={() => setTab(key)}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {error && !bannerModal && !collectionModal && !itemsFor && (
        <div className="info-box" style={{ marginBottom: 12, color: 'var(--danger, #c0392b)' }}>{error}</div>
      )}

      <div className="card full-col">
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
          ) : tab === 'banners' ? (
            banners.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No banners. The customer home screen shows the catalogue and nothing else.
              </div>
            ) : (
              <DataTable columns={bannerColumns} data={banners} />
            )
          ) : collections.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              No collections. Nothing is curated — every product is found by searching for it.
            </div>
          ) : (
            <DataTable columns={collectionColumns} data={collections} />
          )}
        </div>
      </div>

      {/* ── BANNER FORM ── */}
      <Modal
        isOpen={bannerModal}
        onClose={() => setBannerModal(false)}
        title={editingBanner ? `Edit ${editingBanner.title}` : 'New Banner'}
        subtitle="A strip on the customer's home screen, with dates that switch it off by itself"
        width="720px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setBannerModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitBanner} disabled={saving}>
              {saving ? 'Saving…' : editingBanner ? 'Save Changes' : 'Create Banner'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Title <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              className="form-input" placeholder="Diwali Sale"
              value={bannerForm.title}
              onChange={e => setBannerForm({ ...bannerForm, title: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Subtitle</label>
            <input
              className="form-input" placeholder="Up to 40% off"
              value={bannerForm.subtitle}
              onChange={e => setBannerForm({ ...bannerForm, subtitle: e.target.value })}
            />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">How it looks</h3>
        {/* ⚠️ A banner used to BE a flat JPEG — `imageUrl` was required, so no
            banner could exist until somebody opened a design tool, and a headline
            set in an image cannot re-wrap on a narrow phone, cannot honour the
            customer's system font size, and is invisible to a screen reader.
            The card is composed now; artwork is optional decoration on top. */}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 10 }}>
          The card is drawn by the app from the title, the subtitle and the button below — no
          design tool needed. A picture is optional and sits on the right of it.
        </p>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <div className="form-group">
              <label className="form-label">Colour</label>
              <select
                className="form-input"
                value={bannerForm.theme}
                onChange={e => setBannerForm({ ...bannerForm, theme: e.target.value })}
              >
                {Object.entries(THEMES).map(([key, theme]) => (
                  <option key={key} value={key}>{theme.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Button label</label>
              <input
                className="form-input" placeholder="Order Now"
                maxLength={24}
                value={bannerForm.ctaLabel}
                onChange={e => setBannerForm({ ...bannerForm, ctaLabel: e.target.value })}
              />
              {/* A button is a promise that tapping does something, and only a
                  target can keep it. Leaving this blank is the right answer for
                  an announcement. */}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Leave blank for an announcement. The button only appears when the banner opens
                something — see “What it opens” below.
              </div>
            </div>

            <ProductImageUpload
              value={bannerForm.imageUrl}
              onChange={(url) => setBannerForm({ ...bannerForm, imageUrl: url })}
              sign={signBannerImageUpload}
              label="Add a picture (optional)"
              aspect="wide"
              hint="Optional. Works best as a cut-out with a transparent background — it sits to the right of the text."
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              What the customer sees
            </div>
            <BannerPreview banner={bannerForm} />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">When it runs</h3>
        {/* The reason a banner is a model at all. */}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 10 }}>
          The banner appears and disappears on its own. Nobody has to remember to take it down.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="datetime-local" className="form-input"
              value={bannerForm.validFrom}
              onChange={e => setBannerForm({ ...bannerForm, validFrom: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">To <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="datetime-local" className="form-input"
              value={bannerForm.validTo}
              onChange={e => setBannerForm({ ...bannerForm, validTo: e.target.value })}
            />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Where it shows, and what it opens</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Shows on</label>
            <select
              className="form-select"
              value={bannerForm.industryId}
              onChange={e => setBannerForm({ ...bannerForm, industryId: e.target.value })}
            >
              <option value="">Every industry's home screen</option>
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Display order</label>
            <input
              type="number" className="form-input"
              value={bannerForm.sortOrder}
              onChange={e => setBannerForm({ ...bannerForm, sortOrder: e.target.value })}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Lowest first.</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Opens</label>
            {/* One target. The server refuses two; this makes two unreachable. */}
            <select
              className="form-select"
              value={bannerForm.targetType}
              onChange={e => setBannerForm({ ...bannerForm, targetType: e.target.value, targetId: '' })}
            >
              <option value="NONE">Nothing — an announcement</option>
              <option value="SHOP">A shop</option>
              <option value="PRODUCT">A product</option>
              <option value="COUPON">An offer</option>
            </select>
          </div>
          {bannerForm.targetType !== 'NONE' && (
            <div className="form-group">
              <label className="form-label">Which one</label>
              <select
                className="form-select"
                value={bannerForm.targetId}
                onChange={e => setBannerForm({ ...bannerForm, targetId: e.target.value })}
              >
                <option value="">Choose…</option>
                {targetOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="info-box" style={{ marginTop: 12, color: 'var(--danger, #c0392b)' }}>{error}</div>
        )}
      </Modal>

      {/* ── COLLECTION FORM ── */}
      <Modal
        isOpen={collectionModal}
        onClose={() => setCollectionModal(false)}
        title={editingCollection ? `Edit ${editingCollection.title}` : 'New Collection'}
        subtitle="A curated, ordered list — not a discount. Nothing here changes a price."
        width="640px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setCollectionModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitCollection} disabled={saving}>
              {saving ? 'Saving…' : editingCollection ? 'Save Changes' : 'Create Collection'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Title <span style={{ color: 'var(--red)' }}>*</span></label>
          <input
            className="form-input" placeholder="Items under ₹99"
            value={collectionForm.title}
            onChange={e => setCollectionForm({ ...collectionForm, title: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Subtitle</label>
          <input
            className="form-input" placeholder="Small things worth grabbing"
            value={collectionForm.subtitle}
            onChange={e => setCollectionForm({ ...collectionForm, subtitle: e.target.value })}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Industry</label>
            <select
              className="form-select"
              value={collectionForm.industryId}
              onChange={e => setCollectionForm({ ...collectionForm, industryId: e.target.value })}
            >
              <option value="">Every industry</option>
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Shop</label>
            <select
              className="form-select"
              value={collectionForm.shopId}
              onChange={e => setCollectionForm({ ...collectionForm, shopId: e.target.value })}
            >
              <option value="">The platform's own</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.businessName || s.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              A shop's collection shows only on that shop's page.
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Display order</label>
          <input
            type="number" className="form-input"
            value={collectionForm.sortOrder}
            onChange={e => setCollectionForm({ ...collectionForm, sortOrder: e.target.value })}
          />
        </div>

        {error && (
          <div className="info-box" style={{ marginTop: 12, color: 'var(--danger, #c0392b)' }}>{error}</div>
        )}
      </Modal>

      {/* ── ITEM PICKER ──
          The whole list is saved in one write, because order *is* the content —
          add/remove/reorder as three verbs makes "move this to the top" a
          sequence that can half-fail and leave two products claiming the same
          position. */}
      <Modal
        isOpen={!!itemsFor}
        onClose={() => setItemsFor(null)}
        title={itemsFor ? `Products in ${itemsFor.title}` : 'Products'}
        subtitle="The order here is the order customers see"
        width="720px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setItemsFor(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveItems} disabled={saving}>
              {saving ? 'Saving…' : `Save ${picked.length} product${picked.length === 1 ? '' : 's'}`}
            </button>
          </>
        }
      >
        <h3 className="form-section-title">In this collection</h3>
        {picked.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Nothing chosen yet. An empty collection is hidden from customers.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {picked.map((id, index) => {
              const p = products.find((x) => x.id === id);
              return (
                <div
                  key={id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    border: '1px solid var(--border, #e3e3e3)', borderRadius: 8
                  }}
                >
                  <GripVertical size={13} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-muted)', width: 20 }}>
                    {index + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 13 }}>{p ? p.name : `Product #${id}`}</span>
                  <button className="btn btn-ghost" onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
                  <button className="btn btn-ghost" onClick={() => move(index, 1)} disabled={index === picked.length - 1}>↓</button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--danger, #c0392b)' }}
                    onClick={() => setPicked(picked.filter((x) => x !== id))}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="form-divider" />
        <h3 className="form-section-title">Add a product</h3>
        <select
          className="form-select"
          value=""
          onChange={(e) => {
            const id = Number.parseInt(e.target.value, 10);
            // A product appears once — the server refuses a duplicate rather
            // than silently dropping it, so the picker does not offer one.
            if (Number.isInteger(id) && !picked.includes(id)) setPicked([...picked, id]);
          }}
        >
          <option value="">Choose a product…</option>
          {products
            .filter((p) => !picked.includes(p.id))
            .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {error && (
          <div className="info-box" style={{ marginTop: 12, color: 'var(--danger, #c0392b)' }}>{error}</div>
        )}
      </Modal>
    </>
  );
}
