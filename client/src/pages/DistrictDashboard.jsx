import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import Modal from '../components/ui/Modal';
import {
  getOverviewStats,
  getPendingApprovals,
  getActivePartners,
  createPartner,
  approvePartner,
  rejectPartner,
  getDistrictRevenue,
  getDistrictRevenueDetail
} from '../utils/api';

/* ── Static Config ──────────────────────────────────────── */
const CLICKABLE = { cursor: 'pointer' };

const REV_CATEGORIES = [
  { key: 'regions',      emoji: '🤝', name: 'Regions',            bg: '#EFF4FF', color: 'var(--blue)'   },
  { key: 'shops',        emoji: '🏪', name: 'Shop Subscriptions', bg: '#E8F4EF', color: 'var(--green)'  },
  { key: 'distributors', emoji: '📦', name: 'Distributor Subs',   bg: '#FEF3C7', color: 'var(--amber)'  },
  { key: 'delivery',     emoji: '🚚', name: 'Delivery Subs',      bg: '#ECFEFF', color: 'var(--teal)'   }
];

// Maps each revenue row to its drill-down route key (matches backend categories).
const REVENUE_TABLE = [
  { key: 'regions',      emoji: '🤝', label: 'Regions',                   sharePct: 20 },
  { key: 'shops',        emoji: '🏪', label: 'Shop Subscriptions',        sharePct: 20 },
  { key: 'delivery',     emoji: '🚚', label: 'Delivery Subscriptions',    sharePct: 18 },
  { key: 'distributors', emoji: '📦', label: 'Distributor Subscriptions', sharePct: 20 }
];

const REG_SHARE_CONFIG = [
  { label: 'Shop Listing Fee',           hint: '₹5,000/shop',         baseRate: 5000,  defaultPct: 40 },
  { label: 'Delivery Partner Onboarding',hint: '₹2,000/partner',      baseRate: 2000,  defaultPct: 40 },
  { label: 'Distributor Subscription',   hint: '₹10,000/distributor', baseRate: 10000, defaultPct: 35 }
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

const REG_INIT = {
  region: '', fullName: '', mobile: '', email: '', dob: '',
  aadhaarNumber: '', panNumber: '',
  bankName: '', accountNumber: '', ifscCode: '',
  accountType: 'Savings Account', password: 'password123'
};

const DIST_INIT = {
  companyName: '', gstNumber: '', ownerName: '', mobile: '', email: '',
  warehouseAddress: '', region: '',
  bankName: '', accountNumber: '', ifscCode: '', accountType: 'Current',
  subscriptionTier: 'Standard', password: 'password123'
};

/* ── Component ──────────────────────────────────────────── */
const DistrictDashboard = ({ onLogout }) => {
  const { pathname } = useLocation();
  const navigate     = useNavigate();
  const user         = JSON.parse(localStorage.getItem('roadmate_user') || '{}');
  const stateName    = user.stateName    || '';
  const districtName = user.districtName || '';
  const userName     = user.name         || '';
  const industryName = user.industry?.name || 'Industry';
  const industryEmoji = getIndustryEmoji(industryName);
  const industryLabel = `${industryEmoji} ${industryName}`;

  /* State */
  const [stats, setStats] = useState({
    districtRevenue: 0, myShare: 0, regionalPartners: 0,
    activeDistributors: 0, fieldExecutives: 0, pendingApprovals: 0
  });
  const [allApprovals,      setAllApprovals]      = useState([]);
  const [regionalPartners,  setRegionalPartners]  = useState([]);
  const [distributors,      setDistributors]      = useState([]);
  const [executives,        setExecutives]        = useState([]);
  const [shopCount,         setShopCount]         = useState(0);
  const [revenueRows,       setRevenueRows]       = useState([]);
  const [revenueTotals,     setRevenueTotals]     = useState({ totalCollected: 0, myEarnings: 0 });
  const [revDetail,         setRevDetail]         = useState(null);
  const [revDetailLoading,  setRevDetailLoading]  = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [submitting,        setSubmitting]        = useState(false);
  const [period,            setPeriod]            = useState('month'); // 'month' | 'year' | 'all'

  /* Modals */
  const [regModalOpen,  setRegModalOpen]  = useState(false);
  const [distModalOpen, setDistModalOpen] = useState(false);

  /* Forms */
  const [regForm,    setRegForm]    = useState(REG_INIT);
  const [distForm,   setDistForm]   = useState(DIST_INIT);
  const [shareRows,  setShareRows]  = useState(
    REG_SHARE_CONFIG.map((r) => ({ ...r, pct: r.defaultPct }))
  );

  /* File names (visual only) */
  const [regFiles, setRegFiles] = useState({ aadhaar: '', pan: '' });

  /* ── Load on mount + whenever the period filter changes ── */
  useEffect(() => { refreshDashboard(); }, [period]);

  /* ── Route-based modal auto-open ── */
  useEffect(() => {
    if (pathname === '/district/partners') setRegModalOpen(true);
  }, [pathname]);

  /* ── Load revenue drill-down detail when on a detail route ── */
  const REV_DETAIL_PREFIX = '/district/revenue/';
  useEffect(() => {
    if (!pathname.startsWith(REV_DETAIL_PREFIX)) { setRevDetail(null); return; }
    const category = pathname.slice(REV_DETAIL_PREFIX.length);
    let active = true;
    (async () => {
      try {
        setRevDetailLoading(true);
        const data = await getDistrictRevenueDetail(category, period);
        if (active) setRevDetail(data);
      } catch {
        if (active) setRevDetail({ error: true });
      } finally {
        if (active) setRevDetailLoading(false);
      }
    })();
    return () => { active = false; };
  }, [pathname, period]);

  const refreshDashboard = async () => {
    try {
      setLoading(true);
      const [ovData, appData, partData, revData] = await Promise.all([
        getOverviewStats(period),
        getPendingApprovals(),
        getActivePartners(),
        getDistrictRevenue(period)
      ]);
      setStats(ovData.stats || {});
      setAllApprovals(appData.approvals || []);
      const all = partData.partners || [];
      setRegionalPartners(all.filter((p) => p.role === 'REGIONAL'));
      setDistributors(all.filter((p) => p.role === 'DISTRIBUTOR'));
      setExecutives(all.filter((p) => p.role === 'EXECUTIVE'));
      setShopCount(all.filter((p) => p.role === 'SHOP').length);
      setRevenueRows(revData.rows || []);
      setRevenueTotals(revData.totals || { totalCollected: 0, myEarnings: 0 });
    } catch {
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  /* Derived */
  const execApprovals = allApprovals.filter((a) => a.role === 'EXECUTIVE');

  /* Period filter tabs (This Month / This Year / All Time) */
  const PERIOD_TABS = [
    { key: 'month', label: 'This Month' },
    { key: 'year',  label: 'This Year'  },
    { key: 'all',   label: 'All Time'   }
  ];
  const renderPeriodTabs = () => (
    <div className="tabs">
      {PERIOD_TABS.map((t) => (
        <div
          key={t.key}
          className={`tab ${period === t.key ? 'active' : ''}`}
          onClick={() => setPeriod(t.key)}
          style={CLICKABLE}
        >
          {t.label}
        </div>
      ))}
    </div>
  );

  const handleApprove = async (id) => {
    try {
      await approvePartner(id);
      setAllApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch { setError('Failed to approve.'); }
  };

  const handleReject = async (id) => {
    try {
      await rejectPartner(id);
      setAllApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch { setError('Failed to reject.'); }
  };

  const handleRegSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await createPartner({
        role:          'REGIONAL',
        name:          regForm.fullName,
        phone:         regForm.mobile,
        email:         regForm.email,
        regionName:    regForm.region,
        aadhaarNumber: regForm.aadhaarNumber,
        panNumber:     regForm.panNumber,
        bankName:      regForm.bankName,
        accountNumber: regForm.accountNumber,
        ifscCode:      regForm.ifscCode,
        accountType:   regForm.accountType,
        sharePercentage: shareRows[0].pct,
        password:      regForm.password
      });
      setRegModalOpen(false);
      setRegForm(REG_INIT);
      setShareRows(REG_SHARE_CONFIG.map((r) => ({ ...r, pct: r.defaultPct })));
      setRegFiles({ aadhaar: '', pan: '' });
      await refreshDashboard();
    } catch { setError('Failed to create regional partner.'); }
    finally { setSubmitting(false); }
  };

  const handleDistSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await createPartner({
        role:         'DISTRIBUTOR',
        name:         distForm.ownerName,
        phone:        distForm.mobile,
        email:        distForm.email,
        regionName:   distForm.region,
        businessName: distForm.companyName,
        gstNumber:    distForm.gstNumber,
        bankName:     distForm.bankName,
        accountNumber:distForm.accountNumber,
        ifscCode:     distForm.ifscCode,
        accountType:  distForm.accountType,
        monthlyCost:  distForm.subscriptionTier === 'Standard' ? 10000 : 18000,
        password:     distForm.password
      });
      setDistModalOpen(false);
      setDistForm(DIST_INIT);
      await refreshDashboard();
    } catch { setError('Failed to create distributor.'); }
    finally { setSubmitting(false); }
  };

  const badges = { executiveApprovals: execApprovals.length };

  /* ════════════════════════════════════════════════════════
     SUB-PAGE RENDERS
  ════════════════════════════════════════════════════════ */

  /* ── Revenue ── */
  const renderRevenue = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Revenue Summary — {districtName} · {industryLabel}</div>
          <div className="section-sub">Full breakdown from all regions and revenue categories</div>
        </div>
        {renderPeriodTabs()}
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
              {(revenueRows.length ? revenueRows : REVENUE_TABLE).map((row, i) => (
                <tr
                  key={row.key || i}
                  onClick={() => navigate(`/district/revenue/${row.key}`)}
                  style={{ cursor: 'pointer' }}
                  title="View breakdown"
                >
                  <td>{row.emoji} {row.label} <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>›</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {row.totalCollected != null ? formatRupees(row.totalCollected) : '—'}
                  </td>
                  <td className="mono hide-mobile" style={{ textAlign: 'right', color: 'var(--brand)' }}>
                    {row.sharePct}%
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>
                    {row.myEarnings != null ? formatRupees(row.myEarnings) : '—'}
                  </td>
                  <td className="mono hide-mobile" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {row.count != null ? row.count : '—'}
                  </td>
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
            Total:{' '}
            <span className="mono" style={{ fontWeight: 600, color: 'var(--brand)' }}>
              {formatRupees(revenueTotals.totalCollected)}
            </span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            My Earnings:{' '}
            <span className="mono" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--green)' }}>
              {formatRupees(revenueTotals.myEarnings)}
            </span>
          </span>
        </div>
      </div>
    </>
  );

  /* ── Revenue drill-down detail page ── */
  const renderRevenueDetail = () => {
    if (revDetailLoading) {
      return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading breakdown…</div>;
    }
    if (!revDetail || revDetail.error) {
      return (
        <>
          <div className="section-header">
            <div><div className="section-title">Revenue Breakdown</div></div>
          </div>
          <div className="card full-col"><div style={{ padding: '20px', color: 'var(--text-muted)' }}>
            Unable to load this breakdown. <a style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={() => navigate('/district/revenue')}>Back to Revenue Summary</a>
          </div></div>
        </>
      );
    }
    const { category, items = [], totals = {} } = revDetail;
    const isRegions = category.key === 'regions';
    return (
      <>
        <div className="section-header">
          <div>
            <div className="section-title">{category.emoji} {category.label} — {districtName}</div>
            <div className="section-sub">
              <a style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={() => navigate('/district/revenue')}>‹ Revenue Summary</a>
              {' '}· {items.length} {isRegions ? 'regions' : 'partners'} · My share {category.sharePct}%
            </div>
          </div>
        </div>
        <div className="card full-col">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{isRegions ? 'Region' : 'Partner'}</th>
                  <th className="hide-mobile">{isRegions ? 'Lead Partner' : 'Region'}</th>
                  <th style={{ textAlign: 'right' }}>{isRegions ? 'Revenue' : 'Fee Collected'}</th>
                  <th style={{ textAlign: 'right' }} className="hide-mobile">My Share ({category.sharePct}%)</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>No records yet.</td></tr>
                ) : items.map((it) => (
                  <tr key={it.id}>
                    <td>{isRegions ? (it.regionName || '—') : (it.businessName || it.name)}</td>
                    <td className="hide-mobile" style={{ color: 'var(--text-muted)' }}>
                      {isRegions ? it.name : (it.regionName || '—')}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatRupees(it.revenue)}</td>
                    <td className="mono hide-mobile" style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>
                      {formatRupees(it.myShare)}
                    </td>
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
              Total Collected:{' '}
              <span className="mono" style={{ fontWeight: 600, color: 'var(--brand)' }}>{formatRupees(totals.totalRevenue)}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              My Earnings:{' '}
              <span className="mono" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--green)' }}>{formatRupees(totals.totalMyShare)}</span>
            </span>
          </div>
        </div>
      </>
    );
  };

  /* ── Executive Approvals page ── */
  const renderExecApprovals = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">All Executive Approvals — {districtName}</div>
          <div className="section-sub">Shop listing &amp; delivery exec profiles needing district-level approval</div>
        </div>
        <span className="pending-count">⚠ {execApprovals.length} Pending</span>
      </div>
      <div className="info-box">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
          <circle cx="8" cy="8" r="6" stroke="#164E63" strokeWidth="1.4"/>
          <path d="M8 7v4" stroke="#164E63" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span>
          Created by Regional Partners. Approved execs can begin onboarding shops and delivery partners
          in their assigned areas.
        </span>
      </div>
      <div className="card full-col">
        <div style={{ padding: '12px 16px' }}>
          {execApprovals.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              No pending executive profiles require approval.
            </div>
          ) : (
            execApprovals.map((row) => (
              <div key={row.id} className="approval-item">
                <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
                  {initials(row.name)}
                </div>
                <div className="approval-info">
                  <div className="approval-name">{row.name}</div>
                  <div className="approval-meta">
                    {row.regionName || '—'} · {ROLE_LABELS[row.role] || row.role} ·{' '}
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

  /* ── Distributors page ── */
  const renderDistributors = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Distributors — {districtName} · {industryLabel}</div>
          <div className="section-sub">All distributors operating in {districtName} district</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setDistModalOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Add Distributor
        </button>
      </div>
      <div className="card full-col">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Distributor</th>
                <th>Region</th>
                <th>Manufacturer Links</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Shops</th>
                <th style={{ textAlign: 'right' }}>Subscription</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {distributors.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No distributors mapped yet.
                  </td>
                </tr>
              ) : (
                distributors.map((d) => (
                  <tr key={d.id}>
                    <td><div style={{ fontWeight: 500 }}>{d.businessName || d.name}</div></td>
                    <td>
                      <span className="tag tag-teal" style={{ fontSize: '10px' }}>
                        {d.regionName || '—'}
                      </span>
                    </td>
                    <td>—</td>
                    <td className="mono hide-mobile" style={{ textAlign: 'right' }}>—</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {d.monthlyCost ? `₹${Number(d.monthlyCost).toLocaleString('en-IN')}/mo` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`tag ${d.isActive ? 'tag-green' : 'tag-amber'}`}>
                        {d.isActive ? 'Active' : 'Pending'}
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

  /* ── Regional Partners page ── */
  const renderRegionalPartners = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Regional Partners — {districtName}</div>
          <div className="section-sub">All regional {industryName} partners in your district</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setRegModalOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Create Regional
        </button>
      </div>
      <div className="card full-col">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}></th>
                <th>Regional Partner</th>
                <th>Region</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Shops</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Executives</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {regionalPartners.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No regional partners onboarded yet.
                  </td>
                </tr>
              ) : (
                regionalPartners.map((rp) => {
                  const execCount = executives.filter((e) => e.regionName === rp.regionName).length;
                  const shopsInRegion = shopCount; // approximate
                  return (
                    <tr key={rp.id}>
                      <td>
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '50%',
                          background: 'var(--brand-light)', color: 'var(--brand)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700
                        }}>
                          {initials(rp.name)}
                        </div>
                      </td>
                      <td><div style={{ fontWeight: 500 }}>{rp.name}</div></td>
                      <td>
                        <span className="tag tag-teal" style={{ fontSize: '10px' }}>
                          {rp.regionName || '—'}
                        </span>
                      </td>
                      <td className="mono hide-mobile" style={{ textAlign: 'right' }}>—</td>
                      <td className="mono hide-mobile" style={{ textAlign: 'right' }}>
                        {execCount || '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--green)' }}>—</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`tag ${rp.isActive ? 'tag-green' : 'tag-amber'}`} style={{ fontSize: '10px' }}>
                          {rp.isActive ? 'Active' : 'Pending'}
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
    </>
  );

  /* ── Overview ── */
  const renderOverview = () => (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">{districtName} District — {industryLabel} Summary</div>
          <div className="section-sub">Complete business data across all {regionalPartners.length} regions</div>
        </div>
        {renderPeriodTabs()}
      </div>

      {/* Stat Grid Row 1 */}
      <div className="stat-grid">
        <div className="stat-card teal" onClick={() => navigate('/district/revenue')} style={CLICKABLE} title="View revenue summary">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-label">District Revenue</div>
              <div className="stat-value">{formatRupees(stats.districtRevenue)}</div>
              <div className="stat-delta delta-up">All {industryName} revenue</div>
            </div>
            <div style={{ background: 'var(--brand-light)', borderRadius: '8px', padding: '8px', fontSize: '20px' }}>
              🏙️
            </div>
          </div>
        </div>
        <div className="stat-card green" onClick={() => navigate('/district/revenue')} style={CLICKABLE} title="View revenue summary">
          <div className="stat-label">My Share (20%)</div>
          <div className="stat-value">{formatRupees(stats.myShare)}</div>
          <div className="stat-delta delta-up">Earned this month</div>
        </div>
        <div className="stat-card amber" onClick={() => navigate('/district/regional-partners')} style={CLICKABLE} title="View regional partners">
          <div className="stat-label">Regional Partners</div>
          <div className="stat-value">{stats.regionalPartners ?? 0}</div>
          <div className="stat-delta delta-up">All regions covered</div>
        </div>
        <div className="stat-card red" onClick={() => navigate('/district/executive-approvals')} style={CLICKABLE} title="Review executive approvals">
          <div className="stat-label">Exec Approvals</div>
          <div className="stat-value">{execApprovals.length}</div>
          <div className="stat-delta" style={{ color: 'var(--amber)' }}>⚠ Pending review</div>
        </div>
      </div>

      {/* Stat Grid Row 2 */}
      <div className="stat-grid">
        <div className="stat-card blue" onClick={() => navigate('/district/distributors')} style={CLICKABLE} title="View distributors">
          <div className="stat-label">Distributors</div>
          <div className="stat-value">{stats.activeDistributors ?? 0}</div>
          <div className="stat-delta delta-up">Active in district</div>
        </div>
        <div className="stat-card purple" onClick={() => navigate('/district/distributors')} style={CLICKABLE} title="View shops by distributor">
          <div className="stat-label">Registered Shops</div>
          <div className="stat-value">{shopCount}</div>
          <div className="stat-delta delta-up">{industryName} dealers</div>
        </div>
        <div className="stat-card teal" onClick={() => navigate('/district/revenue/delivery')} style={CLICKABLE} title="View delivery breakdown">
          <div className="stat-label">Delivery Partners</div>
          <div className="stat-value">{stats.deliveryPartners ?? 0}</div>
          <div className="stat-delta delta-up">Active delivery execs</div>
        </div>
        <div className="stat-card green" onClick={() => navigate('/district/executive-approvals')} style={CLICKABLE} title="View executives">
          <div className="stat-label">Executives</div>
          <div className="stat-value">{stats.fieldExecutives ?? 0}</div>
          <div className="stat-delta delta-up">Across all regions</div>
        </div>
      </div>

      {/* Revenue by Category */}
      <div className="section-header">
        <div><div className="section-title">Revenue by Category</div></div>
      </div>
      <div className="rev-cat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {REV_CATEGORIES.map((cat, i) => {
          const row = revenueRows.find((r) => r.key === cat.key);
          return (
            <div
              key={i}
              className="rev-cat-card"
              onClick={() => navigate(`/district/revenue/${cat.key}`)}
              style={{ cursor: 'pointer' }}
              title="View breakdown"
            >
              <div className="rev-cat-icon" style={{ background: cat.bg }}>{cat.emoji}</div>
              <div className="rev-cat-name">{cat.name}</div>
              <div className="rev-cat-value" style={{ color: cat.color }}>
                {row && row.totalCollected != null ? formatRupees(row.totalCollected) : '—'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                {row && row.myEarnings != null
                  ? `My share ${formatRupees(row.myEarnings)}`
                  : '—'}
              </div>
            </div>
          );
        })}
      </div>

      {/* 2-col: By Region + Distributors */}
      <div className="two-col">
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
              regionalPartners.slice(0, 8).map((rp, i) => (
                <div
                  key={rp.id}
                  className="region-row"
                  onClick={() => navigate('/district/revenue/regions')}
                  style={CLICKABLE}
                  title="View region revenue"
                >
                  <div className="region-rank">{i + 1}</div>
                  <div className="region-name">{rp.regionName || rp.name}</div>
                  <div className="region-rev">—</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Distributors */}
        <div className="card">
          <div className="card-header">
            <div><div className="section-title" style={{ fontSize: '13px' }}>Distributors</div></div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className="tag tag-blue">{distributors.length} Active</span>
              <button className="btn btn-outline btn-sm" onClick={() => setDistModalOpen(true)}>+ Add</button>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Distributor</th>
                    <th>Region</th>
                    <th style={{ textAlign: 'right' }}>Shops</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {distributors.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>
                        No distributors yet.
                      </td>
                    </tr>
                  ) : (
                    distributors.slice(0, 5).map((d) => (
                      <tr key={d.id} onClick={() => navigate('/district/distributors')} style={CLICKABLE} title="View distributors">
                        <td><div style={{ fontWeight: 500, fontSize: '12.5px' }}>{d.businessName || d.name}</div></td>
                        <td>
                          <span className="tag tag-teal" style={{ fontSize: '10px' }}>{d.regionName || '—'}</span>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>—</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`tag ${d.isActive ? 'tag-green' : 'tag-amber'}`} style={{ fontSize: '10px' }}>
                            {d.isActive ? 'Active' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Regional Partners Table */}
      <div className="section-header">
        <div>
          <div className="section-title">Regional Partners — {districtName}</div>
          <div className="section-sub">All regional {industryName} partners in your district</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setRegModalOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Create Regional
        </button>
      </div>
      <div className="card full-col">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}></th>
                <th>Regional Partner</th>
                <th>Region</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Shops</th>
                <th className="hide-mobile" style={{ textAlign: 'right' }}>Executives</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {regionalPartners.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No regional partners onboarded yet.
                  </td>
                </tr>
              ) : (
                regionalPartners.map((rp) => {
                  const execCount = executives.filter((e) => e.regionName === rp.regionName).length;
                  return (
                    <tr key={rp.id} onClick={() => navigate('/district/regional-partners')} style={CLICKABLE} title="View regional partners">

                      <td>
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '50%',
                          background: 'var(--brand-light)', color: 'var(--brand)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700
                        }}>
                          {initials(rp.name)}
                        </div>
                      </td>
                      <td><div style={{ fontWeight: 500 }}>{rp.name}</div></td>
                      <td>
                        <span className="tag tag-teal" style={{ fontSize: '10px' }}>{rp.regionName || '—'}</span>
                      </td>
                      <td className="mono hide-mobile" style={{ textAlign: 'right' }}>—</td>
                      <td className="mono hide-mobile" style={{ textAlign: 'right' }}>{execCount || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--green)' }}>—</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`tag ${rp.isActive ? 'tag-green' : 'tag-amber'}`} style={{ fontSize: '10px' }}>
                          {rp.isActive ? 'Active' : 'Pending'}
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

      {/* Executive Approvals Section */}
      <div className="section-header">
        <div>
          <div className="section-title">Executive Profile Approvals</div>
          <div className="section-sub">Shop-listing &amp; delivery executives awaiting district approval</div>
        </div>
        <span className="pending-count">⚠ {execApprovals.length} Pending</span>
      </div>
      <div className="card full-col">
        <div style={{ padding: '12px 16px' }}>
          <div className="info-box">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
              <circle cx="8" cy="8" r="6" stroke="#164E63" strokeWidth="1.4"/>
              <path d="M8 7v4" stroke="#164E63" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span>
              As District Partner, you approve Executive profiles created by Regional Partners for
              shop listing &amp; delivery onboarding activities in your district.
            </span>
          </div>
          {execApprovals.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              All executive approvals are up to date.
            </div>
          ) : (
            <>
              {execApprovals.slice(0, 4).map((row) => (
                <div key={row.id} className="approval-item" onClick={() => navigate('/district/executive-approvals')} style={CLICKABLE} title="Review executive approvals">
                  <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
                    {initials(row.name)}
                  </div>
                  <div className="approval-info">
                    <div className="approval-name">{row.name}</div>
                    <div className="approval-meta">
                      {row.regionName || '—'} · {ROLE_LABELS[row.role] || row.role} ·{' '}
                      <span className="tag tag-teal" style={{ fontSize: '10px' }}>
                        {row.monthlyCost ? `₹${Number(row.monthlyCost).toLocaleString('en-IN')}/mo` : 'Pending'}
                      </span>
                    </div>
                  </div>
                  <div className="approval-actions">
                    <button className="btn-approve" onClick={(e) => { e.stopPropagation(); handleApprove(row.id); }}>Approve</button>
                    <button className="btn-reject"  onClick={(e) => { e.stopPropagation(); handleReject(row.id); }}>Reject</button>
                  </div>
                </div>
              ))}
              {execApprovals.length > 4 && (
                <div style={{ padding: '10px 0', textAlign: 'center' }}>
                  <button className="btn btn-outline btn-sm">
                    View All {execApprovals.length} Pending →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  /* ── Route switch ── */
  const renderContent = () => {
    if (pathname.startsWith('/district/revenue/')) return renderRevenueDetail();
    switch (pathname) {
      case '/district/revenue':           return renderRevenue();
      case '/district/executive-approvals':return renderExecApprovals();
      case '/district/distributors':      return renderDistributors();
      case '/district/regional-partners': return renderRegionalPartners();
      default:                            return renderOverview();
    }
  };

  /* ════════════════════════════════════════════════════════
     MODALS
  ════════════════════════════════════════════════════════ */

  const renderRegionalModal = () => (
    <Modal
      isOpen={regModalOpen}
      onClose={() => setRegModalOpen(false)}
      title="Create Regional Partner Profile"
      subtitle={`Assign a regional partner in ${districtName} — ${industryLabel}`}
      width="800px"
      footer={
        <>
          <button className="btn btn-outline" onClick={() => setRegModalOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleRegSubmit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Regional Partner'}
          </button>
        </>
      }
    >
      <form onSubmit={handleRegSubmit}>
        {/* Location Assignment */}
        <div className="form-section-title">Location Assignment</div>
        <div className="location-chain">
          <span className="lc-step done">🌐 India</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">📍 {stateName}</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">{industryEmoji} {industryName}</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">🏙️ {districtName}</span>
          <span className="lc-sep">›</span>
          <span className={`lc-step ${regForm.region ? 'done' : ''}`}>
            {regForm.region ? `📍 ${regForm.region}` : 'Select Region ↓'}
          </span>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">District</label>
            <input className="form-input" value={districtName} readOnly
              style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}/>
          </div>
          <div>
            <label className="form-label">Region / Area <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select" required
              value={regForm.region}
              onChange={(e) => setRegForm({ ...regForm, region: e.target.value })}>
              <option value="">Select Region</option>
              <option>Banjara Hills</option>
              <option>Jubilee Hills</option>
              <option>Kukatpally</option>
              <option>Secunderabad</option>
              <option>Dilsukhnagar</option>
              <option>Ameerpet</option>
              <option>LB Nagar</option>
              <option>Uppal</option>
            </select>
            <div className="form-hint">Each region can have one Regional Partner per industry</div>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Personal Details */}
        <div className="form-section-title">Personal Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Full Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Full name" required
              value={regForm.fullName}
              onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="tel" placeholder="+91 XXXXX XXXXX" required
              value={regForm.mobile}
              onChange={(e) => setRegForm({ ...regForm, mobile: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Email Address</label>
            <input className="form-input" type="email" placeholder="partner@example.com"
              value={regForm.email}
              onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Date of Birth</label>
            <input className="form-input" type="date"
              value={regForm.dob}
              onChange={(e) => setRegForm({ ...regForm, dob: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Aadhaar Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="XXXX XXXX XXXX" maxLength={14}
              value={regForm.aadhaarNumber}
              onChange={(e) => setRegForm({ ...regForm, aadhaarNumber: e.target.value })}/>
            <div style={{ marginTop: '6px' }}>
              <div className="upload-zone" onClick={() => document.getElementById('rp-aad').click()}>
                <span>🪪</span><span>{regFiles.aadhaar || 'Upload Aadhaar'}</span>
              </div>
              <input type="file" id="rp-aad" accept=".pdf,.jpg,.png" style={{ display: 'none' }}
                onChange={(e) => e.target.files[0] && setRegFiles({ ...regFiles, aadhaar: '✓ ' + e.target.files[0].name })}/>
            </div>
          </div>
          <div>
            <label className="form-label">PAN Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="ABCDE1234F" maxLength={10}
              style={{ textTransform: 'uppercase' }}
              value={regForm.panNumber}
              onChange={(e) => setRegForm({ ...regForm, panNumber: e.target.value })}/>
            <div style={{ marginTop: '6px' }}>
              <div className="upload-zone" onClick={() => document.getElementById('rp-pan').click()}>
                <span>🪪</span><span>{regFiles.pan || 'Upload PAN'}</span>
              </div>
              <input type="file" id="rp-pan" accept=".pdf,.jpg,.png" style={{ display: 'none' }}
                onChange={(e) => e.target.files[0] && setRegFiles({ ...regFiles, pan: '✓ ' + e.target.files[0].name })}/>
            </div>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Revenue Share */}
        <div className="form-section-title">Revenue Share Configuration</div>
        <div className="info-box">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="8" cy="8" r="6" stroke="#164E63" strokeWidth="1.4"/>
            <path d="M8 7v4" stroke="#164E63" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>
            Regional Partners earn the highest share of each revenue event. After District approval,
            profile goes to Industry State → State → Master for final activation.
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
              value={regForm.bankName}
              onChange={(e) => setRegForm({ ...regForm, bankName: e.target.value })}>
              <option value="">Select Bank</option>
              <option>State Bank of India</option><option>HDFC Bank</option>
              <option>ICICI Bank</option><option>Axis Bank</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Account Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Account number"
              value={regForm.accountNumber}
              onChange={(e) => setRegForm({ ...regForm, accountNumber: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">IFSC Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="SBIN0001234"
              value={regForm.ifscCode}
              onChange={(e) => setRegForm({ ...regForm, ifscCode: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Account Type</label>
            <select className="form-select"
              value={regForm.accountType}
              onChange={(e) => setRegForm({ ...regForm, accountType: e.target.value })}>
              <option>Savings Account</option>
              <option>Current Account</option>
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );

  const renderDistributorModal = () => (
    <Modal
      isOpen={distModalOpen}
      onClose={() => setDistModalOpen(false)}
      title="Create Distributor Profile"
      subtitle={`Add a distributor for ${districtName} District — ${industryLabel}`}
      width="800px"
      footer={
        <>
          <button className="btn btn-outline" onClick={() => setDistModalOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleDistSubmit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Distributor'}
          </button>
        </>
      }
    >
      <form onSubmit={handleDistSubmit}>
        {/* Location */}
        <div className="form-section-title">Location &amp; Region Assignment</div>
        <div className="location-chain">
          <span className="lc-step done">🌐 India</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">📍 {stateName}</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">{industryEmoji} {industryName}</span>
          <span className="lc-sep">›</span>
          <span className="lc-step done">🏙️ {districtName}</span>
          <span className="lc-sep">›</span>
          <span className={`lc-step ${distForm.region ? 'done' : ''}`}>
            {distForm.region ? `📍 ${distForm.region}` : 'Select Region ↓'}
          </span>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">District</label>
            <input className="form-input" value={districtName} readOnly
              style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}/>
          </div>
          <div>
            <label className="form-label">Service Region <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select" required
              value={distForm.region}
              onChange={(e) => setDistForm({ ...distForm, region: e.target.value })}>
              <option value="">Select Region</option>
              <option>Banjara Hills</option><option>Jubilee Hills</option>
              <option>Kukatpally</option><option>Secunderabad</option>
              <option>Dilsukhnagar</option><option>Ameerpet</option>
              <option>Multiple Regions</option>
            </select>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Company Details */}
        <div className="form-section-title">Company Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Company Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Distributor company name" required
              value={distForm.companyName}
              onChange={(e) => setDistForm({ ...distForm, companyName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">GST Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="27XXXXX1234X1ZX" required
              value={distForm.gstNumber}
              onChange={(e) => setDistForm({ ...distForm, gstNumber: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Owner / Contact Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Full name" required
              value={distForm.ownerName}
              onChange={(e) => setDistForm({ ...distForm, ownerName: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="tel" placeholder="+91 XXXXX XXXXX" required
              value={distForm.mobile}
              onChange={(e) => setDistForm({ ...distForm, mobile: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Email Address</label>
            <input className="form-input" type="email" placeholder="distributor@company.com"
              value={distForm.email}
              onChange={(e) => setDistForm({ ...distForm, email: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Warehouse Address</label>
            <input className="form-input" type="text" placeholder="Primary warehouse location"
              value={distForm.warehouseAddress}
              onChange={(e) => setDistForm({ ...distForm, warehouseAddress: e.target.value })}/>
          </div>
        </div>

        <div className="form-divider"/>
        {/* Manufacturer Mapping */}
        <div className="form-section-title">Manufacturer Mapping</div>
        <div className="info-box">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="8" cy="8" r="6" stroke="#164E63" strokeWidth="1.4"/>
            <path d="M8 7v4" stroke="#164E63" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>
            Link this distributor to manufacturers in the {industryName} industry. They will receive
            product orders and supply to retail shops in their region.
          </span>
        </div>
        <div className="form-full">
          <label className="form-label">Link Manufacturers <span style={{ color: 'var(--red)' }}>*</span></label>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px'
          }}>
            {[
              '🚗 Tata Motors Ltd.', '🚗 Maruti Suzuki India',
              '🏍️ Hero MotoCorp', '🏍️ TVS Motor Company', '🔵 Apollo Tyres'
            ].map((mfr, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked={i === 0 || i === 2}
                  style={{ accentColor: 'var(--brand)' }}/>
                <span>{mfr}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-divider"/>
        {/* Platform Subscription */}
        <div className="form-section-title">Platform Subscription</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          {[
            { tier: 'Standard', price: '₹10,000', desc: 'per month · Up to 50 shops' },
            { tier: 'Premium',  price: '₹18,000', desc: 'per month · Unlimited shops' }
          ].map(({ tier, price, desc }) => (
            <div
              key={tier}
              className={`sub-tier-card ${distForm.subscriptionTier === tier ? 'selected' : ''}`}
              onClick={() => setDistForm({ ...distForm, subscriptionTier: tier })}
            >
              <div className="sub-tier-label">{tier}</div>
              <div className="sub-tier-price">{price}</div>
              <div className="sub-tier-period">{desc}</div>
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
              value={distForm.bankName}
              onChange={(e) => setDistForm({ ...distForm, bankName: e.target.value })}>
              <option value="">Select Bank</option>
              <option>State Bank of India</option><option>HDFC Bank</option>
              <option>ICICI Bank</option><option>Axis Bank</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Account Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="Account number"
              value={distForm.accountNumber}
              onChange={(e) => setDistForm({ ...distForm, accountNumber: e.target.value })}/>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">IFSC Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="form-input" type="text" placeholder="SBIN0001234"
              value={distForm.ifscCode}
              onChange={(e) => setDistForm({ ...distForm, ifscCode: e.target.value })}/>
          </div>
          <div>
            <label className="form-label">Account Type</label>
            <select className="form-select"
              value={distForm.accountType}
              onChange={(e) => setDistForm({ ...distForm, accountType: e.target.value })}>
              <option>Current Account</option>
              <option>Savings Account</option>
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );

  /* ── Header action buttons ── */
  const actionButton = (
    <div style={{ display: 'flex', gap: '8px' }}>
      <button className="btn btn-outline" onClick={() => setDistModalOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="6" width="12" height="8" rx="1.5" stroke="#6B6A64" strokeWidth="1.4"/>
          <path d="M5 6V4a3 3 0 016 0v2" stroke="#6B6A64" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        Distributor
      </button>
      <button className="btn btn-primary" onClick={() => setRegModalOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        Regional Partner
      </button>
    </div>
  );

  /* ── Render ── */
  return (
    <DashboardLayout
      role="DISTRICT"
      badges={badges}
      onLogout={onLogout}
      title={`District Dashboard — ${industryLabel} · ${districtName}`}
      subtitle={`All ${industryName} business data for ${districtName} district across all ${regionalPartners.length} regions`}
      actionButton={actionButton}
      searchPlaceholder="Search regions, partners…"
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
      {renderRegionalModal()}
      {renderDistributorModal()}
    </DashboardLayout>
  );
};

export default DistrictDashboard;
