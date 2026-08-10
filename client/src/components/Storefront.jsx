// The customer's home screen, as an editor (the storefront pass, 2026-08-10).
//
// ── WHAT THIS TURNS ON ────────────────────────────────────────────────────────
//
// `Industry.iconUrl` has been in the schema since Phase 0 carrying the comment
// "the tab icons in the Customer design". `Category.iconUrl` has been there just
// as long. **Neither had ever been written to**, because no endpoint and no
// screen could: industries are created by `prisma/seed.js` and categories by
// nobody at all. Two dead columns describing a feature nobody could switch on —
// so the customer's industry rail rendered as text chips, and there was no
// category row at all.
//
// This screen is the write side. `taxonomyController.js` is the API.
//
// ── THE RULE THIS SCREEN HAS TO MAKE VISIBLE ──────────────────────────────────
//
// **An icon is optional and the app looks finished without one.** The Customer
// app ships artwork for every industry and category it recognises, keyed by slug
// (`apps/consumer/src/art.js`), and an uploaded image *overrides* it. So the
// honest label for the upload box is "replace the built-in artwork", not "add a
// missing image" — and a category with no icon is not an error state to chase.
//
// ── WHY INDUSTRIES CANNOT BE CREATED OR DELETED HERE ──────────────────────────
//
// An industry owns products, shops, orders, coupons and per-industry config
// rows, and `Industry.fulfilmentType` is the switch `server/src/lib/fulfilment.js`
// reads to decide whether an order needs a prescription, needs prep time, or is
// voucher-only. Creating one from a web form makes a category with no fulfilment
// branch, no shops and no config; deleting one orphans every order ever placed
// in it. Only presentation is editable, and the screen says so rather than
// hiding buttons that would look like a permissions problem.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, ArrowUp, ArrowDown, Eye, EyeOff, LoaderCircle, Info
} from 'lucide-react';
import Modal from './ui/Modal';
import DataTable from './ui/DataTable';
import Tag from './ui/Tag';
import ProductImageUpload from './ProductImageUpload';
import {
  getMasterIndustries, updateMasterIndustry, setIndustryOrder,
  getMasterCategories, createCategory, updateCategory, deleteCategory,
  signTaxonomyIconUpload
} from '../utils/api';

/**
 * The glyph the Customer app falls back to, mirrored here so this screen can
 * show what a tile *actually looks like* with no upload.
 *
 * ⚠️ This is a copy of `apps/consumer/src/art.js`'s table and it is a copy on
 * purpose: a web dashboard and a React Native bundle share no code, and the
 * alternative — a seventh API endpoint whose only job is to tell a browser which
 * emoji a phone would draw — is more machinery than the duplication costs. If a
 * glyph is wrong in one place it is cosmetic in both. The *rule* it illustrates
 * (uploaded image wins, artwork stands in) is enforced in the app, not here.
 */
const FALLBACK_GLYPH = {
  automobile: '🛺', groceries: '🛒', grocery: '🛒', restaurant: '🍔', food: '🍔',
  electronics: '📱', textiles: '👗', fashion: '👗', apparel: '👗',
  pharmacy: '💊', medicine: '💊', sports: '🏏', gym: '🏋️', fitness: '🏋️'
};

const blankCategory = () => ({ name: '', slug: '', iconUrl: null, sortOrder: '0' });

export default function Storefront() {
  const [tab, setTab] = useState('industries');

  const [industries, setIndustries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [scopeIndustryId, setScopeIndustryId] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState(blankCategory());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [i, c] = await Promise.all([
        getMasterIndustries(),
        getMasterCategories(scopeIndustryId || undefined)
      ]);
      setIndustries(i.industries ?? []);
      setCategories(c.categories ?? []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the storefront.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scopeIndustryId]);

  const say = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 3500);
  };

  const fail = (err, fallback) => setError(err.response?.data?.message || fallback);

  // ── industries ─────────────────────────────────────────────────────────────

  const patchIndustry = async (id, patch) => {
    setSaving(true);
    setError('');
    try {
      await updateMasterIndustry(id, patch);
      await load();
    } catch (err) {
      fail(err, 'Could not update that industry.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Move one row and write the **whole** order back.
   *
   * The API takes an array and assigns positions from the index inside one
   * transaction, so "move Grocery up" is one write that either happens or does
   * not. Two PATCHes swapping two `sortOrder`s can half-fail and leave both rows
   * claiming the same position — at which point the customer-facing tie-break
   * (name) silently decides the shop front.
   */
  const move = async (index, direction) => {
    const next = [...industries];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];

    setIndustries(next); // optimistic: the row moves under the cursor
    setSaving(true);
    try {
      const result = await setIndustryOrder(next.map((i) => i.id));
      setIndustries(result.industries ?? next);
    } catch (err) {
      fail(err, 'Could not save that order.');
      await load(); // the optimistic move was a lie; go back to the truth
    } finally {
      setSaving(false);
    }
  };

  // ── categories ─────────────────────────────────────────────────────────────

  const openCategory = (category) => {
    setEditingCategory(category ?? null);
    setCategoryForm(
      category
        ? {
            name: category.name,
            slug: category.slug,
            iconUrl: category.iconUrl,
            sortOrder: String(category.sortOrder ?? 0)
          }
        : blankCategory()
    );
    setCategoryModal(true);
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) return setError('A category needs a name.');
    if (!editingCategory && !scopeIndustryId) {
      return setError('Choose which industry this category belongs to first.');
    }

    setSaving(true);
    setError('');
    try {
      const body = {
        name: categoryForm.name.trim(),
        iconUrl: categoryForm.iconUrl,
        sortOrder: Number.parseInt(categoryForm.sortOrder, 10) || 0
      };
      // The slug is only sent when a human edited it. Sending the derived one
      // back on every save would freeze a handle that should follow the name.
      if (categoryForm.slug && (!editingCategory || categoryForm.slug !== editingCategory.slug)) {
        body.slug = categoryForm.slug;
      }

      if (editingCategory) await updateCategory(editingCategory.id, body);
      else await createCategory({ ...body, industryId: Number(scopeIndustryId) });

      setCategoryModal(false);
      say(editingCategory ? 'Category updated.' : 'Category created.');
      await load();
    } catch (err) {
      fail(err, 'Could not save that category.');
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (category) => {
    if (!window.confirm(`Delete “${category.name}”? This does not delete any product.`)) return;
    setSaving(true);
    setError('');
    try {
      await deleteCategory(category.id);
      say('Category deleted.');
      await load();
    } catch (err) {
      // A 409 is the meaningful one: products are still filed under it, and the
      // message names how many. Not a retry — the category has to be emptied.
      fail(err, 'Could not delete that category.');
    } finally {
      setSaving(false);
    }
  };

  // ── rendering ──────────────────────────────────────────────────────────────

  const tile = (row, kind) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {row.iconUrl ? (
        <img
          src={row.iconUrl}
          alt=""
          style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover', border: '1px solid var(--border,#e3e3e3)' }}
        />
      ) : (
        <div
          title="No image uploaded — the app draws its own artwork for this tile"
          style={{
            width: 40, height: 40, borderRadius: 12, background: '#FFF4CC',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
          }}
        >
          {kind === 'industry' ? (FALLBACK_GLYPH[row.slug] ?? '🛍️') : '🏷️'}
        </div>
      )}
      <div>
        <div style={{ fontWeight: 600 }}>{row.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.slug}</div>
      </div>
    </div>
  );

  const industryColumns = [
    { key: 'name', label: 'Industry', render: (row) => tile(row, 'industry') },
    {
      key: 'art',
      label: 'Tile artwork',
      render: (row) => (
        <div style={{ maxWidth: 300 }}>
          <ProductImageUpload
            value={row.iconUrl}
            onChange={(url) => patchIndustry(row.id, { iconUrl: url })}
            sign={signTaxonomyIconUpload}
            label="Replace tile artwork"
            hint="Optional. With no image the app draws its own artwork for this industry."
          />
        </div>
      )
    },
    {
      key: 'counts',
      label: 'Content',
      render: (row) => (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          <div>{row.categoryCount ?? 0} categories</div>
          {/* A shop count of 0 is the reason a tile answers "not here yet", and
              it is invisible everywhere else on this dashboard. */}
          <div style={{ color: row.shopCount ? 'inherit' : 'var(--danger,#c0392b)' }}>
            {row.shopCount ?? 0} shops
          </div>
        </div>
      )
    },
    {
      key: 'state',
      label: 'Shown in app',
      render: (row) => (
        <Tag type={row.isActive ? 'green' : 'red'} text={row.isActive ? 'Visible' : 'Hidden'} />
      )
    },
    {
      key: 'actions',
      label: 'Order',
      render: (row) => {
        const index = industries.findIndex((i) => i.id === row.id);
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-outline btn-sm" disabled={saving || index === 0} onClick={() => move(index, -1)} title="Move up">
              <ArrowUp size={13} />
            </button>
            <button
              className="btn btn-outline btn-sm"
              disabled={saving || index === industries.length - 1}
              onClick={() => move(index, 1)}
              title="Move down"
            >
              <ArrowDown size={13} />
            </button>
            <button
              className="btn btn-outline btn-sm"
              disabled={saving}
              onClick={() => patchIndustry(row.id, { isActive: !row.isActive })}
              title={row.isActive ? 'Hide from the app' : 'Show in the app'}
            >
              {row.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        );
      }
    }
  ];

  const categoryColumns = [
    { key: 'name', label: 'Category', render: (row) => tile(row, 'category') },
    { key: 'industry', label: 'Industry', render: (row) => row.industry?.name ?? '—' },
    { key: 'sortOrder', label: 'Position', render: (row) => row.sortOrder },
    { key: 'productCount', label: 'Products', render: (row) => row.productCount ?? 0 },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={() => openCategory(row)}>
            <Pencil size={13} />
          </button>
          <button className="btn btn-outline btn-sm" disabled={saving} onClick={() => removeCategory(row)}>
            <Trash2 size={13} />
          </button>
        </div>
      )
    }
  ];

  const scoped = useMemo(
    () => (scopeIndustryId ? categories.filter((c) => c.industryId === Number(scopeIndustryId)) : categories),
    [categories, scopeIndustryId]
  );

  return (
    <div className="full-col">
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">Storefront</h2>
            <p className="section-sub">
              The two rails at the top of the customer's home screen — the industry tiles, and the
              category row under the banners.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn-sm ${tab === 'industries' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTab('industries')}
            >
              Industries
            </button>
            <button
              className={`btn btn-sm ${tab === 'categories' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTab('categories')}
            >
              Categories
            </button>
          </div>
        </div>

        <div className="card-body">
          {/* The single most important thing on this screen, said before anybody
              starts hunting for missing images. */}
          <div
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              background: 'var(--surface-2,#f7f7f9)', border: '1px solid var(--border,#e3e3e3)',
              borderRadius: 10, padding: '10px 12px', fontSize: 12, lineHeight: 1.6, marginBottom: 14
            }}
          >
            <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>Artwork is optional.</strong> The customer app already draws a tile for every
              industry and category it recognises, so the rail looks finished with nothing uploaded.
              An image here <em>replaces</em> that artwork — it is not filling a gap.
            </span>
          </div>

          {error && (
            <div style={{ color: 'var(--danger,#c0392b)', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          {notice && (
            <div style={{ color: 'var(--success,#1e8e4e)', fontSize: 13, marginBottom: 12 }}>{notice}</div>
          )}

          {loading ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 24, color: 'var(--text-muted)' }}>
              <LoaderCircle size={15} className="spin" /> Loading…
            </div>
          ) : tab === 'industries' ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Industries cannot be created or deleted here. An industry owns products, shops,
                orders and its own tax and delivery settings, and it decides whether an order needs
                a prescription — only how it is presented is editable.
              </p>
              <DataTable
                columns={industryColumns}
                data={industries}
                emptyMessage="No industries exist. Run the database seed first."
              />
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
                <select
                  className="form-input"
                  style={{ maxWidth: 280 }}
                  value={scopeIndustryId}
                  onChange={(e) => setScopeIndustryId(e.target.value)}
                >
                  <option value="">All industries</option>
                  {industries.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => openCategory(null)}
                  disabled={!scopeIndustryId}
                  // A category belongs to exactly one industry and cannot be
                  // moved later (its products carry an industryId of their own),
                  // so the scope is chosen before the name rather than inside a
                  // form where it looks like a field that can be changed.
                  title={scopeIndustryId ? 'Add a category' : 'Choose an industry first'}
                >
                  <Plus size={13} /> New category
                </button>
              </div>
              <DataTable
                columns={categoryColumns}
                data={scoped}
                emptyMessage={
                  scopeIndustryId
                    ? 'This industry has no categories yet, so the customer app shows no category row for it.'
                    : 'No categories exist yet.'
                }
              />
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={categoryModal}
        onClose={() => setCategoryModal(false)}
        title={editingCategory ? 'Edit category' : 'New category'}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={categoryForm.name}
              onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Oil & Lubes"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Position</label>
            <input
              className="form-input"
              type="number"
              value={categoryForm.sortOrder}
              onChange={(e) => setCategoryForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Lowest first. Ties fall back to alphabetical.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Tile artwork</label>
            <ProductImageUpload
              value={categoryForm.iconUrl}
              onChange={(url) => setCategoryForm((f) => ({ ...f, iconUrl: url }))}
              sign={signTaxonomyIconUpload}
              label="Upload category artwork"
              hint="Optional. With no image the app picks an icon from the category's name."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setCategoryModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveCategory} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
