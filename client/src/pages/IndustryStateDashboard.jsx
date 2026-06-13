import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import Modal from '../components/ui/Modal';
import {
  getOverviewStats,
  getPendingApprovals,
  getActivePartners,
  createPartner,
  approvePartner,
  rejectPartner
} from '../utils/api';

/* ── Static Config ──────────────────────────────────────── */
const REV_CATEGORIES = [
  { emoji: '🤝', name: 'Partnerships',       bg: '#EFF4FF', color: 'var(--blue)'   },
  { emoji: '🏪', name: 'Shop Subscriptions', bg: '#E8F4EF', color: 'var(--green)'  },
  { emoji: '🚚', name: 'Delivery Subs',       bg: '#ECFEFF', color: 'var(--teal)'   },
  { emoji: '📦', name: 'Distributor Subs',    bg: '#FEF3C7', color: 'var(--amber)'  },
  { emoji: '🏭', name: 'Manufacturer Subs',   bg: '#F5F3FF', color: 'var(--purple)' }
];

const REVENUE_TABLE = [
  { emoji: '🤝', label: 'Partnerships',              sharePct: 15 },
  { emoji: '🏪', label: 'Shop Subscriptions',        sharePct: 15 },
  { emoji: '🚚', label: 'Delivery Subscriptions',    sharePct: 12 },
  { emoji: '📦', label: 'Distributor Subscriptions', sharePct: 15 },
  { emoji: '🏭', label: 'Manufacturer Subscriptions',sharePct: 12 }
];

const DIST_SHARE_CONFIG = [
  { label: 'Shop Listing Fee',          hint: '₹5,000/shop',         baseRate: 5000,  defaultPct: 20 },
  { label: 'Distributor Subscription',  hint: '₹10,000/distributor', baseRate: 10000, defaultPct: 20 },
  { label: 'Manufacturer Subscription', hint: '₹15,000/manufacturer',baseRate: 15000, defaultPct: 18 }
];

const ROLE_LABELS = {
  STATE: 'State Partner', IND_STATE: 'Industry State Partner',
  DISTRICT: 'District Partner', REGIONAL: 'Regional Partner',
  MANUFACTURER: 'Manufacturer', DISTRIBUTOR: 'Distributor',
  SHOP: 'Shop', EXECUTIVE: 'Executive'
};

const formatRupees = (n) => {
  if (!n) return '₹0';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Number(n).toLocaleString('en-IN')}`;
};

const fmtDate = (iso) => (iso ? iso.substring(0, 10) : '—');
const initials = (name) =>
  name ? name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : '?';

const getIndustryEmoji = (name = '') => {
  const n = name.toLowerCase();
  if (n.includes('auto') || n.includes('vehicle')) return '🚗';
  if (n.includes('textile') || n.includes('cloth'))  return '👗';
  if (n.includes('agri') || n.includes('farm'))      return '🌾';
  if (n.includes('electr'))                           return '📱';
  if (n.includes('food') || n.includes('beverage'))  return '🍜';
  return '🏭';
};

const DIST_INIT = {
  district: '', fullName: '', mobile: '', email: '', dob: '',
  businessName: '', gstNumber: '', aadhaarNumber: '', panNumber: '',
  bankName: '', accountHolder: '', accountNumber: '', ifscCode: '',
  accountType: 'Savings Account', upiId: '', password: 'password123'
};

const MFR_INIT = {
  companyName: '', brandName: '', gstNumber: '', cinNumber: '',
  subCategory: '', hqState: '',
  contactName: '', designation: '', contactMobile: '', contactEmail: '',
  subscriptionTier: 'Standard',
  bankName: '', accountNumber: '', ifscCode: '', accountType: 'Current',
  password: 'password123'
};

/* ── Component ──────────────────────────────────────────── */
const IndustryStateDashboard = ({ onLogout }) => {
  const { pathname } = useLocation();
  const user       = JSON.parse(localStorage.getItem('roadmate_user') || '{}');
  const stateName  = user.stateName  || '';
  const userName   = user.name       || '';
  const industryName = user.industry?.name || 'Industry';
  const industryEmoji = getIndustryEmoji(industryName);
  const industryLabel = `${industryEmoji} ${industryName}`;

  /* State */
  const [stats, setStats] = useState({
    industryRevenue: 0, myShare: 0, districtPartners: 0,
    regionalPartners: 0, activeManufacturers: 0, pendingApprovals: 0
  });
  const [approvals,        setApprovals]        = useState([]);
  const [districtPartners, setDistrictPartners] = useState([]);
  const [regionalPartners, setRegionalPartners] = useState([]);
  const [manufacturers,    setManufacturers]    = useState([]);
  const [shopCount,        setShopCount]        = useState(0);
  const [distributorCount, setDistributorCount] = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [submitting,       setSubmitting]       = useState(false);

  /* Modals */
  const [districtModalOpen, setDistrictModalOpen] = useState(false);
  const [mfrModalOpen,      setMfrModalOpen]      = useState(false);

  /* Forms */
  const [districtForm, setDistrictForm] = useState(DIST_INIT);
  const [mfrForm,      setMfrForm]      = useState(MFR_INIT);
  const [shareRows,    setShareRows]    = useState(
    DIST_SHARE_CONFIG.map((r) => ({ ...r, pct: r.defaultPct }))
  );

  /* File names (visual only) */
  const [dpFiles,  setDpFiles]  = useState({ aadhaar: '', pan: '', agreement: '' });
  const [mfrFiles, setMfrFiles] = useState({ gst: '', pan: '' });

  /* ── Load on mount ── */
  useEffect(() => { refreshDashboard(); }, []);

  /* ── Route-based modal auto-open ── */
  useEffect(() => {
    if (pathname === '/industry-state/partners')          setDistrictModalOpen(true);
    else if (pathname === '/industry-state/create-manufacturer') setMfrModalOpen(true);
  }, [pathname]);

  const refreshDashboard = async () => {
    try {
      setLoading(true);
      const [ovData, appData, partData] = await Promise.all([
        getOverviewStats(),
        getPendingApprovals(),
        getActivePartners()
      ]);
      setStats(ovData.stats || {});
      setApprovals(appData.approvals || []);
      const all = partData.partners || [];
      setDistrictPartners(all.filter((p) => p.role === 'DISTRICT'));
      setRegionalPartners(all.filter((p) => p.role === 'REGIONAL'));
      setManufacturers(all.filter((p) => p.role === 'MANUFACTURER'));
      setShopCount(all.filter((p) => p.role === 'SHOP').length);
      setDistributorCount(all.filter((p) => p.role === 'DISTRIBUTOR').length);
    } catch {
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      await approvePartner(id);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch { setError('Failed to approve.'); }
  };

  const handleReject = async (id) => {
    try {
      await rejectPartner(id);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch { setError('Failed to reject.'); }
  };

  const handleDistrictSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await createPartner({
        role: 'DISTRICT',
        name:          districtForm.fullName,
        phone:         districtForm.mobile,
        email:         districtForm.email,
        districtName:  districtForm.district,
        businessName:  districtForm.businessName,
        gstNumber:     districtForm.gstNumber,
        aadhaarNumber: districtForm.aadhaarNumber,
        panNumber:     districtForm.panNumber,
        bankName:      districtForm.bankName,
        accountHolder: districtForm.accountHolder,
        accountNumber: districtForm.accountNumber,
        ifscCode:      districtForm.ifscCode,
        accountType:   districtForm.accountType,
        upiId:         districtForm.upiId,
        sharePercentage: shareRows[0].pct,
        password:      districtForm.password
      });
      setDistrictModalOpen(false);
      setDistrictForm(DIST_INIT);
      setShareRows(DIST_SHARE_CONFIG.map((r) => ({ ...r, pct: r.defaultPct })));
      setDpFiles({ aadhaar: '', pan: '', agreement: '' });
      await refreshDashboard();
    } catch { setError('Failed to create district partner.'); }
    finally { setSubmitting(false); }
  };

  const handleMfrSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await createPartner({
        role:          'MANUFACTURER',
        name:          mfrForm.companyName,
        phone:         mfrForm.contactMobile,
        email:         mfrForm.contactEmail,
        businessName:  mfrForm.brandName,
        gstNumber:     mfrForm.gstNumber,
        bankName:      mfrForm.bankName,
        accountNumber: mfrForm.accountNumber,
        ifscCode:      mfrForm.ifscCode,
        accountType:   mfrForm.accountType,
        password:      mfrForm.password
      });
      setMfrModalOpen(false);
      setMfrForm(MFR_INIT);
      setMfrFiles({ gst: '', pan: '' });
      await refreshDashboard();
    } catch { setError('Failed to create manufacturer profile.'); }
    finally { setSubmitting(false); }
  };

  /* ── Helpers ── */
  const getDistrictStats = (dn) => ({
    regions:      regionalPartners.filter((p) => p.districtName === dn).length
  });

  const badges = { approvals: approvals.length, manufacturers: manufacturers.length };

  /* ════════════════════════════════════════════════════════
     SUB-PAGE RENDERS
  ════════════════════════════════════════════════════════ */

  /* ── Revenue Summary ── */
  const renderRevenue = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Revenue Summary — {industryLabel} · {stateName}</div>
          <div className="section-sub">Complete breakdown from all districts, regions and revenue categories</div>
        </div>
        <div className="tabs">
          <div className="tab active">This Month</div>
          <div className="tab">This Year</div>
          <div className="tab">All Time</div>
        </div>
      </div>
      <div className="card full-col">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Revenue Category</th>
                <th style={{ textAlign: 'right' }}>Total Collected</th>
                <th style={{ textAlign: 'right' }} className="hide-mobile">My Share %</th>
                <th style={{ textAlign: 'right' }}>My Earnings</th>
                <th style={{ textAlign: 'right' }} className="hide-mobile">Count</th>
              </tr>
            </thead>
            <tbody>
              {REVENUE_TABLE.map((row, i) => (
                <tr key={i}>
                  <td>{row.emoji} {row.label}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>—</td>
                  <td className="mono hide-mobile" style={{ textAlign: 'right', color: 'var(--brand)' }}>
                    {row.sharePct}%
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>—</td>
                  <td className="mono hide-mobile" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: '24px', fontSize: '13px'
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Total Industry Revenue:{' '}
            <span className="mono" style={{ fontWeight: 600, color: 'var(--brand)' }}>
              {formatRupees(stats.industryRevenue)}
            </span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            My Earnings (this month):{' '}
            <span className="mono" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--green)' }}>
              {formatRupees(stats.myShare)}
            </span>
          </span>
        </div>
      </div>
    </>
  );

  /* ── Approvals Page ── */
  const renderApprovals = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Regional Partner Approvals — {industryLabel} · {stateName}</div>
          <div className="section-sub">All regional partner profiles in {industryName} industry awaiting your approval</div>
        </div>
        <span className="pending-count">⚠ {approvals.length} Pending</span>
      </div>
      <div className="info-box" style={{ background: 'var(--brand-light)', borderColor: '#DDD6FE', color: '#5B21B6' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
          <circle cx="8" cy="8" r="6" stroke="#7C3AED" strokeWidth="1.4"/>
          <path d="M8 7v4" stroke="#7C3AED" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span>
          You approve Regional Partner profiles for {industryName} in {stateName}.
          District Partner profiles go directly to State Partner for approval — you don't approve those.
        </span>
      </div>
      <div className="card full-col">
        <div style={{ padding: '12px 16px' }}>
          {approvals.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              All approvals are up to date.
            </div>
          ) : (
            approvals.map((row) => (
              <div key={row.id} className="approval-item">
                <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
                  {initials(row.name)}
                </div>
                <div className="approval-info">
                  <div className="approval-name">{row.name}</div>
                  <div className="approval-meta">
                    {row.regionName || row.districtName || row.stateName || '—'} ·{' '}
                    {ROLE_LABELS[row.role] || row.role} ·{' '}
                    <span style={{
                      background: 'var(--brand-light)', color: 'var(--brand)',
                      fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '20px'
                    }}>
                      Applied {fmtDate(row.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="approval-actions">
                  <button className="btn-approve" onClick={() => handleApprove(row.id)}>Approve</button>
                  <button className="btn-reject"  onClick={() => handleReject(row.id)}>Reject</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );

  /* ── Manufacturers Page ── */
  const renderManufacturers = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Manufacturers — {industryLabel} · {stateName}</div>
          <div className="section-sub">All {industryName} manufacturers active on the RoadMate platform</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setMfrModalOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Add Manufacturer
        </button>
      </div>
      <div className="card full-col">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Manufacturer</th>
                <th>Brand / Products</th>
                <th className="hide-mobile">HQ State</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Distributors</th>
                <th style={{ textAlign: 'right' }}>Subscription</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {manufacturers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No manufacturers onboarded yet.
                  </td>
                </tr>
              ) : (
                manufacturers.map((mfr) => (
                  <tr key={mfr.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{mfr.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Since: {fmtDate(mfr.createdAt)}
                      </div>
                    </td>
                    <td>{mfr.businessName || '—'}</td>
                    <td className="hide-mobile">{mfr.stateName || '—'}</td>
                    <td className="mono hide-mobile" style={{ textAlign: 'right' }}>—</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {mfr.monthlyCost ? `₹${Number(mfr.monthlyCost).toLocaleString('en-IN')}/mo` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`tag ${mfr.isActive ? 'tag-green' : 'tag-amber'}`}>
                        {mfr.isActive ? 'Active' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  /* ── Overview Page (default) ── */
  const renderOverview = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">{industryLabel} Industry — {stateName} Summary</div>
          <div className="section-sub">Complete business data for your industry within {stateName}</div>
        </div>
        <div className="tabs">
          <div className="tab active">This Month</div>
          <div className="tab">This Year</div>
          <div className="tab">All Time</div>
        </div>
      </div>

      {/* Stat Grid Row 1 */}
      <div className="stat-grid">
        <div className="stat-card purple">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-label">Industry Revenue ({stateName})</div>
              <div className="stat-value">{formatRupees(stats.industryRevenue)}</div>
              <div className="stat-delta delta-up">All {industryName} revenue</div>
            </div>
            <div style={{ background: 'var(--brand-light)', borderRadius: '8px', padding: '8px', fontSize: '20px' }}>
              {industryEmoji}
            </div>
          </div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">My Share</div>
          <div className="stat-value">{formatRupees(stats.myShare)}</div>
          <div className="stat-delta delta-up">Earned this month</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">District Partners</div>
          <div className="stat-value">{stats.districtPartners ?? 0}</div>
          <div className="stat-delta delta-up">Active in {stateName} {industryName}</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Pending Approvals</div>
          <div className="stat-value">{approvals.length}</div>
          <div className="stat-delta" style={{ color: 'var(--amber)' }}>⚠ Awaiting review</div>
        </div>
      </div>

      {/* Stat Grid Row 2 */}
      <div className="stat-grid">
        <div className="stat-card teal">
          <div className="stat-label">Regional Partners</div>
          <div className="stat-value">{stats.regionalPartners ?? 0}</div>
          <div className="stat-delta delta-up">Active partners</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Registered Shops</div>
          <div className="stat-value">{shopCount}</div>
          <div className="stat-delta delta-up">{industryName} dealers</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Manufacturers</div>
          <div className="stat-value">{stats.activeManufacturers ?? 0}</div>
          <div className="stat-delta delta-up">Active in platform</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Distributors</div>
          <div className="stat-value">{distributorCount}</div>
          <div className="stat-delta delta-up">Active fulfillment hubs</div>
        </div>
      </div>

      {/* Revenue by Category */}
      <div className="section-header">
        <div>
          <div className="section-title">Revenue by Category</div>
          <div className="section-sub">{industryName} industry revenue split across all revenue models — {stateName}</div>
        </div>
      </div>
      <div className="rev-cat-grid">
        {REV_CATEGORIES.map((cat, i) => (
          <div key={i} className="rev-cat-card">
            <div className="rev-cat-icon" style={{ background: cat.bg }}>{cat.emoji}</div>
            <div className="rev-cat-name">{cat.name}</div>
            <div className="rev-cat-value" style={{ color: cat.color }}>—</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>—</div>
          </div>
        ))}
      </div>

      {/* 3-col: By District, By Region, Top Manufacturers */}
      <div className="three-col">
        {/* Revenue by District */}
        <div className="card">
          <div className="card-header">
            <div><div className="section-title" style={{ fontSize: '13px' }}>Revenue by District</div></div>
            <span className="tag tag-purple">{districtPartners.length} Districts</span>
          </div>
          <div className="card-body" style={{ paddingTop: '8px' }}>
            {districtPartners.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: '12.5px' }}>No district partners yet.</div>
            ) : (
              districtPartners.slice(0, 6).map((dp, i) => (
                <div key={dp.id} className="region-row">
                  <div className="region-rank">{i + 1}</div>
                  <div className="region-name">{dp.districtName || dp.name}</div>
                  <div className="region-rev">—</div>
                </div>
              ))
            )}
            {districtPartners.length > 0 && (
              <div style={{ marginTop: '12px', textAlign: 'center' }}>
                <button className="btn btn-outline btn-sm">All Districts</button>
              </div>
            )}
          </div>
        </div>

        {/* Revenue by Region */}
        <div className="card">
          <div className="card-header">
            <div><div className="section-title" style={{ fontSize: '13px' }}>Revenue by Region</div></div>
            <span className="tag tag-teal">{regionalPartners.length} Regions</span>
          </div>
          <div className="card-body" style={{ paddingTop: '8px' }}>
            {regionalPartners.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: '12.5px' }}>No regional partners yet.</div>
            ) : (
              regionalPartners.slice(0, 6).map((rp, i) => (
                <div key={rp.id} className="region-row">
                  <div className="region-rank">{i + 1}</div>
                  <div className="region-name">{rp.regionName || rp.name}</div>
                  <div className="region-rev">—</div>
                </div>
              ))
            )}
            {regionalPartners.length > 0 && (
              <div style={{ marginTop: '12px', textAlign: 'center' }}>
                <button className="btn btn-outline btn-sm">All Regions</button>
              </div>
            )}
          </div>
        </div>

        {/* Top Manufacturers */}
        <div className="card">
          <div className="card-header">
            <div><div className="section-title" style={{ fontSize: '13px' }}>Top Manufacturers</div></div>
            <span className="tag tag-amber">{manufacturers.length} Active</span>
          </div>
          <div className="card-body" style={{ paddingTop: '8px' }}>
            {manufacturers.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: '12.5px' }}>No manufacturers onboarded yet.</div>
            ) : (
              manufacturers.slice(0, 6).map((mfr, i) => (
                <div key={mfr.id} className="region-row">
                  <div className="region-rank">{i + 1}</div>
                  <div className="region-name">{mfr.businessName || mfr.name}</div>
                  <div className="region-rev">—</div>
                </div>
              ))
            )}
            {manufacturers.length > 0 && (
              <div style={{ marginTop: '12px', textAlign: 'center' }}>
                <button className="btn btn-outline btn-sm" onClick={() => {}}>All Manufacturers</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* District Partners Table */}
      <div className="section-header">
        <div>
          <div className="section-title">District Partners — {industryLabel} · {stateName}</div>
          <div className="section-sub">Created by you — each manages {industryName} business in their district</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setDistrictModalOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Create District Partner
        </button>
      </div>
      <div className="card full-col">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}></th>
                <th>District Partner</th>
                <th>District</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Regions</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {districtPartners.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No district partners yet.
                  </td>
                </tr>
              ) : (
                districtPartners.map((dp) => {
                  const ds = getDistrictStats(dp.districtName);
                  return (
                    <tr key={dp.id}>
                      <td>
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '50%',
                          background: 'var(--brand-light)', color: 'var(--brand)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700
                        }}>
                          {initials(dp.name)}
                        </div>
                      </td>
                      <td><div style={{ fontWeight: 500 }}>{dp.name}</div></td>
                      <td>
                        <span className="tag tag-purple" style={{ fontSize: '10px' }}>
                          {dp.districtName || '—'}
                        </span>
                      </td>
                      <td className="mono hide-mobile" style={{ textAlign: 'right' }}>
                        {ds.regions || '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--green)' }}>—</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`tag ${dp.isActive ? 'tag-green' : 'tag-amber'}`} style={{ fontSize: '10px' }}>
                          {dp.isActive ? 'Active' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Approvals Section */}
      <div className="section-header">
        <div>
          <div className="section-title">Regional Partner Approval Requests</div>
          <div className="section-sub">Regional partners awaiting your approval before going to State Partner</div>
        </div>
        <span className="pending-count">⚠ {approvals.length} Pending</span>
      </div>
      <div className="card full-col">
        <div style={{ padding: '12px 16px' }}>
          <div className="info-box" style={{ background: 'var(--brand-light)', borderColor: '#DDD6FE', color: '#5B21B6' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
              <circle cx="8" cy="8" r="6" stroke="#7C3AED" strokeWidth="1.4"/>
              <path d="M8 7v4" stroke="#7C3AED" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span>
              As Industry State Partner, you approve Regional Partner profiles for {industryName} in {stateName}.
              After your approval, these go to State Partner, then Master for final activation.
            </span>
          </div>
          {approvals.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              All approvals are up to date.
            </div>
          ) : (
            approvals.map((row) => (
              <div key={row.id} className="approval-item">
                <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
                  {initials(row.name)}
                </div>
                <div className="approval-info">
                  <div className="approval-name">{row.name}</div>
                  <div className="approval-meta">
                    {row.regionName || row.districtName || '—'} · {row.industry?.name || industryName} ·{' '}
                    <span style={{
                      background: 'var(--brand-light)', color: 'var(--brand)',
                      fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '20px'
                    }}>
                      40% share
                    </span>
                  </div>
                </div>
                <div className="approval-actions">
                  <button className="btn-approve" onClick={() => handleApprove(row.id)}>Approve</button>
                  <button className="btn-reject"  onClick={() => handleReject(row.id)}>Reject</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );

  /* ── Route switch ── */
  const renderContent = () => {
    switch (pathname) {
      case '/industry-state/revenue':           return renderRevenue();
      case '/industry-state/approvals':         return renderApprovals();
      case '/industry-state/manufacturers':     return renderManufacturers();
      default:                                  return renderOverview();
    }
  };

  /* ════════════════════════════════════════════════════════
     MODALS
  ════════════════════════════════════════════════════════ */

  const renderDistrictModal = () => (
    <Modal
      isOpen={districtModalOpen}
      onClose={() => setDistrictModalOpen(false)}
      title="Create District Partner Profile"
      subtitle={`Assign a district-level ${industryName} partner within ${stateName}`}
      width="800px"
      footer={
        <>
          <button className="btn btn-outline" onClick={() => setDistrictModalOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleDistrictSubmit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create District Partner'}
          </button>
        </>
      }
    >
      <form onSubmit={handleDistrictSubmit}>
        {/* Location Assignment */}
        <div className="form-section-title">Location Assignment</div>
        <div className="location-chain">
          <span className="lc-step done">🌐 India</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">📍 {stateName}</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">{industryEmoji} {industryName}</span>
          <span className="lc-sep">›</span>
          <span className={`lc-step ${districtForm.district ? 'done' : ''}`}>
            {districtForm.district ? `🏙️ ${districtForm.district}` : 'Select District ↓'}
          </span>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">State</label>
            <input className="form-input" value={stateName} readOnly
              style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}/>
          </div>
          <div>
            <label className="form-label">Industry</label>
            <input className="form-input" value={industryLabel} readOnly
              style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}/>
          </div>
        </div>
        <div className="form-full">
          <label className="form-label">District <span style={{ color: 'var(--red)' }}>*</span></label>
          <select className="form-select" required
            value={districtForm.district}
            onChange={(e) => setDistrictForm({ ...districtForm, district: e.target.value })}>
            <option value="">Select District</option>
            <option>Hyderabad</option><option>Rangareddy</option>
            <option>Medchal-Malkajgiri</option><option>Warangal</option>
            <option>Karimnagar</option><option>Nalgonda</option>
            <option>Khammam</option><option>Nizamabad</option>
          </select>
          <div className="form-hint">Each district in your industry can have one District Partner</div>
        </div>

        <div className="form-divider"/>
        {/* Personal Details */}
        <div className="form-section-title">Personal Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Full Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Full name" required
              value={districtForm.fullName}
              onChange={(e) => setDistrictForm({ ...districtForm, fullName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="tel" placeholder="+91 XXXXX XXXXX" required
              value={districtForm.mobile}
              onChange={(e) => setDistrictForm({ ...districtForm, mobile: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Email Address</label>
            <input className="form-input" type="email" placeholder="partner@example.com"
              value={districtForm.email}
              onChange={(e) => setDistrictForm({ ...districtForm, email: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Date of Birth</label>
            <input className="form-input" type="date"
              value={districtForm.dob}
              onChange={(e) => setDistrictForm({ ...districtForm, dob: e.target.value })}/>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Business Details */}
        <div className="form-section-title">Business Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Business Name</label>
            <input className="form-input" type="text" placeholder="Registered business name"
              value={districtForm.businessName}
              onChange={(e) => setDistrictForm({ ...districtForm, businessName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">GST Number</label>
            <input className="form-input" type="text" placeholder="27XXXXX1234X1ZX"
              value={districtForm.gstNumber}
              onChange={(e) => setDistrictForm({ ...districtForm, gstNumber: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Aadhaar Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="XXXX XXXX XXXX" maxLength={14}
              value={districtForm.aadhaarNumber}
              onChange={(e) => setDistrictForm({ ...districtForm, aadhaarNumber: e.target.value })}/>
            <div style={{ marginTop: '6px' }}>
              <div className="upload-zone" onClick={() => document.getElementById('dp-aadhaar').click()}>
                <span>🪪</span>
                <span>{dpFiles.aadhaar || 'Upload Aadhaar — PDF / JPG'}</span>
              </div>
              <input type="file" id="dp-aadhaar" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                onChange={(e) => e.target.files[0] && setDpFiles({ ...dpFiles, aadhaar: '✓ ' + e.target.files[0].name })}/>
            </div>
          </div>
          <div>
            <label className="form-label">PAN Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="ABCDE1234F" maxLength={10}
              style={{ textTransform: 'uppercase' }}
              value={districtForm.panNumber}
              onChange={(e) => setDistrictForm({ ...districtForm, panNumber: e.target.value })}/>
            <div style={{ marginTop: '6px' }}>
              <div className="upload-zone" onClick={() => document.getElementById('dp-pan').click()}>
                <span>🪪</span>
                <span>{dpFiles.pan || 'Upload PAN — PDF / JPG'}</span>
              </div>
              <input type="file" id="dp-pan" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                onChange={(e) => e.target.files[0] && setDpFiles({ ...dpFiles, pan: '✓ ' + e.target.files[0].name })}/>
            </div>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Revenue Share Configuration */}
        <div className="form-section-title">Revenue Share Configuration</div>
        <div className="info-box" style={{ background: 'var(--brand-light)', borderColor: '#DDD6FE', color: '#5B21B6' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="8" cy="8" r="6" stroke="#7C3AED" strokeWidth="1.4"/>
            <path d="M8 7v4" stroke="#7C3AED" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>
            Set the % this District Partner earns from each revenue event in their district.
            Revenue share flows: Regional → District → Industry State → State → Platform.
          </span>
        </div>
        <div className="share-rev-table">
          <div className="share-rev-header">
            <div>Revenue Model</div>
            <div style={{ textAlign: 'right' }}>Share %</div>
            <div style={{ textAlign: 'right' }}>Gets (₹)</div>
          </div>
          {shareRows.map((row, i) => (
            <div key={i} className="share-rev-row">
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{row.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{row.hint}</div>
              </div>
              <input
                className="share-pct-input"
                type="number"
                value={row.pct}
                min={0}
                max={100}
                onChange={(e) => {
                  const updated = [...shareRows];
                  updated[i] = { ...updated[i], pct: Number(e.target.value) };
                  setShareRows(updated);
                }}
              />
              <div className="share-amount-display">
                ₹{Math.round(row.baseRate * row.pct / 100).toLocaleString('en-IN')}
              </div>
            </div>
          ))}
        </div>

        <div className="form-divider"/>
        {/* Bank Details */}
        <div className="form-section-title">Bank Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Bank Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select"
              value={districtForm.bankName}
              onChange={(e) => setDistrictForm({ ...districtForm, bankName: e.target.value })}>
              <option value="">Select Bank</option>
              <option>State Bank of India</option><option>HDFC Bank</option>
              <option>ICICI Bank</option><option>Axis Bank</option>
              <option>Kotak Mahindra Bank</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Account Holder Name</label>
            <input className="form-input" type="text" placeholder="As per bank records"
              value={districtForm.accountHolder}
              onChange={(e) => setDistrictForm({ ...districtForm, accountHolder: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Account Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Account number"
              value={districtForm.accountNumber}
              onChange={(e) => setDistrictForm({ ...districtForm, accountNumber: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">IFSC Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="SBIN0001234"
              value={districtForm.ifscCode}
              onChange={(e) => setDistrictForm({ ...districtForm, ifscCode: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Account Type</label>
            <select className="form-select"
              value={districtForm.accountType}
              onChange={(e) => setDistrictForm({ ...districtForm, accountType: e.target.value })}>
              <option>Savings Account</option>
              <option>Current Account</option>
            </select>
          </div>
          <div>
            <label className="form-label">UPI ID (optional)</label>
            <input className="form-input" type="text" placeholder="name@upi"
              value={districtForm.upiId}
              onChange={(e) => setDistrictForm({ ...districtForm, upiId: e.target.value })}/>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Documents */}
        <div className="form-section-title">Documents</div>
        <div className="form-full">
          <label className="form-label">Partnership Agreement <span style={{ color: 'var(--red)' }}>*</span></label>
          <div className="upload-zone upload-zone-lg"
            onClick={() => document.getElementById('dp-agreement').click()}>
            <div style={{ fontSize: '22px', marginBottom: '6px' }}>📄</div>
            <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '3px' }}>
              {dpFiles.agreement || 'Click to upload signed agreement'}
            </div>
            <div style={{ fontSize: '11.5px' }}>PDF, DOC, DOCX up to 10MB</div>
          </div>
          <input type="file" id="dp-agreement" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
            onChange={(e) => e.target.files[0] && setDpFiles({ ...dpFiles, agreement: '✓ ' + e.target.files[0].name })}/>
        </div>
      </form>
    </Modal>
  );

  const renderManufacturerModal = () => (
    <Modal
      isOpen={mfrModalOpen}
      onClose={() => setMfrModalOpen(false)}
      title="Create Manufacturer Profile"
      subtitle={`Add a manufacturer to the RoadMate platform — ${industryLabel} · ${stateName}`}
      width="800px"
      footer={
        <>
          <button className="btn btn-outline" onClick={() => setMfrModalOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleMfrSubmit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Manufacturer Profile'}
          </button>
        </>
      }
    >
      <form onSubmit={handleMfrSubmit}>
        {/* Company Information */}
        <div className="form-section-title">Company Information</div>
        <div className="form-row">
          <div>
            <label className="form-label">Company Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Registered company name" required
              value={mfrForm.companyName}
              onChange={(e) => setMfrForm({ ...mfrForm, companyName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Brand Name</label>
            <input className="form-input" type="text" placeholder="Brand name (if different)"
              value={mfrForm.brandName}
              onChange={(e) => setMfrForm({ ...mfrForm, brandName: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">GST Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="27XXXXX1234X1ZX" required
              value={mfrForm.gstNumber}
              onChange={(e) => setMfrForm({ ...mfrForm, gstNumber: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">CIN Number</label>
            <input className="form-input" type="text" placeholder="Company Identification Number"
              value={mfrForm.cinNumber}
              onChange={(e) => setMfrForm({ ...mfrForm, cinNumber: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Industry Category</label>
            <input className="form-input" value={industryLabel} readOnly
              style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}/>
          </div>
          <div>
            <label className="form-label">Sub-category <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select" required
              value={mfrForm.subCategory}
              onChange={(e) => setMfrForm({ ...mfrForm, subCategory: e.target.value })}>
              <option value="">Select</option>
              <option>Cars &amp; SUVs</option>
              <option>Two Wheelers</option>
              <option>Three Wheelers</option>
              <option>Commercial Vehicles</option>
              <option>Tyres &amp; Accessories</option>
              <option>Auto Parts</option>
              <option>Electric Vehicles</option>
            </select>
          </div>
        </div>
        <div className="form-full">
          <label className="form-label">Headquarters State</label>
          <select className="form-select"
            value={mfrForm.hqState}
            onChange={(e) => setMfrForm({ ...mfrForm, hqState: e.target.value })}>
            <option value="">Select HQ State</option>
            <option>Telangana</option><option>Maharashtra</option>
            <option>Karnataka</option><option>Tamil Nadu</option>
            <option>Delhi</option><option>Gujarat</option><option>Other</option>
          </select>
        </div>

        <div className="form-divider"/>
        {/* Contact Person */}
        <div className="form-section-title">Contact Person</div>
        <div className="form-row">
          <div>
            <label className="form-label">Contact Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Primary contact name" required
              value={mfrForm.contactName}
              onChange={(e) => setMfrForm({ ...mfrForm, contactName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Designation</label>
            <input className="form-input" type="text" placeholder="e.g. Regional Manager"
              value={mfrForm.designation}
              onChange={(e) => setMfrForm({ ...mfrForm, designation: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="tel" placeholder="+91 XXXXX XXXXX" required
              value={mfrForm.contactMobile}
              onChange={(e) => setMfrForm({ ...mfrForm, contactMobile: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Email Address</label>
            <input className="form-input" type="email" placeholder="contact@company.com"
              value={mfrForm.contactEmail}
              onChange={(e) => setMfrForm({ ...mfrForm, contactEmail: e.target.value })}/>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Platform Subscription */}
        <div className="form-section-title">Platform Subscription</div>
        <div className="sub-tier-grid">
          {[
            { tier: 'Standard',   price: '₹10,000' },
            { tier: 'Premium',    price: '₹15,000' },
            { tier: 'Enterprise', price: '₹25,000' }
          ].map(({ tier, price }) => (
            <div
              key={tier}
              className={`sub-tier-card ${mfrForm.subscriptionTier === tier ? 'selected' : ''}`}
              onClick={() => setMfrForm({ ...mfrForm, subscriptionTier: tier })}
            >
              <div className="sub-tier-label">{tier}</div>
              <div className="sub-tier-price">{price}</div>
              <div className="sub-tier-period">per month</div>
            </div>
          ))}
        </div>

        <div className="form-divider"/>
        {/* Bank Details */}
        <div className="form-section-title">Bank Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Bank Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select"
              value={mfrForm.bankName}
              onChange={(e) => setMfrForm({ ...mfrForm, bankName: e.target.value })}>
              <option value="">Select Bank</option>
              <option>State Bank of India</option><option>HDFC Bank</option>
              <option>ICICI Bank</option><option>Axis Bank</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Account Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Account number"
              value={mfrForm.accountNumber}
              onChange={(e) => setMfrForm({ ...mfrForm, accountNumber: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">IFSC Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="SBIN0001234"
              value={mfrForm.ifscCode}
              onChange={(e) => setMfrForm({ ...mfrForm, ifscCode: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Account Type</label>
            <select className="form-select"
              value={mfrForm.accountType}
              onChange={(e) => setMfrForm({ ...mfrForm, accountType: e.target.value })}>
              <option>Current Account</option>
              <option>Savings Account</option>
            </select>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Documents */}
        <div className="form-section-title">Documents</div>
        <div className="form-row">
          <div>
            <label className="form-label">GST Certificate <span style={{ color: 'var(--red)' }}>*</span></label>
            <div className="upload-zone" onClick={() => document.getElementById('mfr-gst').click()}>
              <span>📋</span>
              <span>{mfrFiles.gst || 'Upload GST Certificate'}</span>
            </div>
            <input type="file" id="mfr-gst" accept=".pdf,.jpg" style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && setMfrFiles({ ...mfrFiles, gst: '✓ ' + e.target.files[0].name })}/>
          </div>
          <div>
            <label className="form-label">Company PAN</label>
            <div className="upload-zone" onClick={() => document.getElementById('mfr-pan').click()}>
              <span>🪪</span>
              <span>{mfrFiles.pan || 'Upload PAN Card'}</span>
            </div>
            <input type="file" id="mfr-pan" accept=".pdf,.jpg" style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && setMfrFiles({ ...mfrFiles, pan: '✓ ' + e.target.files[0].name })}/>
          </div>
        </div>
      </form>
    </Modal>
  );

  /* ── Header action buttons ── */
  const actionButton = (
    <div style={{ display: 'flex', gap: '8px' }}>
      <button className="btn btn-outline" onClick={() => setMfrModalOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="6" width="12" height="8" rx="1.5" stroke="#6B6A64" strokeWidth="1.4"/>
          <path d="M5 6V4a3 3 0 016 0v2" stroke="#6B6A64" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        Manufacturer
      </button>
      <button className="btn btn-primary" onClick={() => setDistrictModalOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        District Partner
      </button>
    </div>
  );

  /* ── Render ── */
  return (
    <DashboardLayout
      role="IND_STATE"
      badges={badges}
      onLogout={onLogout}
      title={`Industry State Dashboard — ${industryLabel} · ${stateName}`}
      subtitle={`All ${industryName} industry data for ${stateName} — districts, regions, manufacturers`}
      actionButton={actionButton}
      searchPlaceholder="Search districts, manufacturers…"
    >
      <div className="content">
        {error && (
          <div style={{
            background: 'var(--red-light)', color: 'var(--red)',
            padding: '10px 16px', borderRadius: 'var(--radius-sm)',
            marginBottom: '16px', fontSize: '13px'
          }}>
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading dashboard…
          </div>
        ) : (
          renderContent()
        )}
      </div>

      {/* Modals */}
      {renderDistrictModal()}
      {renderManufacturerModal()}
    </DashboardLayout>
  );
};

export default IndustryStateDashboard;
