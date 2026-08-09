import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StatCard from '../components/ui/StatCard';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Tag from '../components/ui/Tag';
import { Plus, Download, MapPin, MapPinOff } from 'lucide-react';
import LocationPicker from '../components/LocationPicker';
import {
  getOverviewStats,
  getPendingApprovals,
  getActivePartners,
  createPartner,
  setPartnerLocation
} from '../utils/api';

/* ── Static revenue category rows for revenue page ── */
const REV_CATEGORIES = [
  { emoji: '🤝', label: 'Partnerships',            sharePct: '40%' },
  { emoji: '🏪', label: 'Shop Subscriptions',      sharePct: '40%' },
  { emoji: '📦', label: 'Distributor Subscriptions', sharePct: '40%' },
];

/* ── Rev-cat-grid cards for overview ── */
const REV_CAT_CARDS = [
  { key: 'partnerships', emoji: '🤝', name: 'Partnerships',      color: 'var(--blue)',   bg: '#EFF4FF', to: '/regional/revenue' },
  { key: 'shops',        emoji: '🏪', name: 'Shop Subscriptions', color: 'var(--accent)', bg: '#E8F4EF', to: '/regional/shop-subscriptions' },
  { key: 'distributors', emoji: '📦', name: 'Distributor Subs',   color: 'var(--amber)',  bg: '#FEF3C7', to: '/regional/distributors' },
];

/* ── Helpers ── */
const formatRupees = (n) => {
  if (!n || n === 0) return '₹0';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
};

const initials = (name = '') =>
  name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

const EXEC_TYPE_LABEL = {
  SHOP_LISTING:       'Shop Listing Executive',
  DELIVERY_ONBOARDING:'Delivery Partner Executive',
};

const EXEC_AVATAR_COLORS = [
  { bg: '#ECFEFF', color: '#0891B2' },
  { bg: '#E8F4EF', color: '#1C6A4E' },
  { bg: '#F5F3FF', color: '#7C3AED' },
  { bg: '#EFF4FF', color: '#2563EB' },
  { bg: '#FEF3C7', color: '#B45309' },
  { bg: '#FEF2F2', color: '#DC2626' },
];

const RegionalDashboard = ({ onLogout }) => {
  const { pathname } = useLocation();
  const navigate     = useNavigate();
  const user         = JSON.parse(localStorage.getItem('roadmate_user') || '{}');
  const regionName   = user.regionName   || '';
  const districtName = user.districtName || '';
  const stateName    = user.stateName    || '';
  const industryName = user.industry?.name || 'Industry';

  /* ── State ── */
  const [stats,              setStats]              = useState({});
  const [shops,              setShops]              = useState([]);
  const [executives,         setExecutives]         = useState([]);
  const [nearbyDistributors, setNearbyDistributors] = useState([]);
  const [approvals,          setApprovals]          = useState([]);
  const [badges,             setBadges]             = useState({ executives: 0, shops: 0, delivery: 0 });

  /* ── Modal ── */
  const [execModalOpen, setExecModalOpen] = useState(false);

  /* ── Shop onboarding + location repair (PHASE A.1) ──
   *
   * A shop's coordinates decide whether it can trade at all: `rankCandidateShops`
   * prefilters on the lat/lng index, so a shop with NULL ones matches nothing,
   * forever, and nothing anywhere reports it missing. Two surfaces, one picker —
   * onboard a shop with a pin, and put a pin on a shop that never got one. */
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [shopSubmitting, setShopSubmitting] = useState(false);
  const [shopError, setShopError] = useState('');
  const defaultShopForm = {
    ownerName: '', mobile: '', email: '', password: '',
    businessName: '', gstNumber: '', monthlyCost: '', serviceRadiusKm: '5'
  };
  const [shopForm, setShopForm] = useState(defaultShopForm);
  const [shopPin, setShopPin] = useState(null);

  const [locatingShop, setLocatingShop] = useState(null); // the row being placed
  const [locationPin, setLocationPin] = useState(null);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState('');

  /* ── Executive form ── */
  const [execType, setExecType] = useState('SHOP_LISTING');
  const [execForm, setExecForm] = useState({
    fullName: '', mobile: '', email: '', dob: '',
    aadhaar: '', pan: '',
    target: '', compensation: '6000',
    bankName: '', accountNumber: '', ifscCode: '', accountType: 'Savings',
  });

  /* ── Load ── */
  const refreshDashboard = async () => {
    try {
      const [ovData, appData, partData] = await Promise.all([
        getOverviewStats(),
        getPendingApprovals(),
        getActivePartners(),
      ]);
      const s   = ovData.stats || {};
      const all = partData.partners || [];

      const shopList  = all.filter(p => p.role === 'SHOP');
      const execList  = all.filter(p => p.role === 'EXECUTIVE');
      const distList  = all.filter(p => p.role === 'DISTRIBUTOR');

      setStats(s);
      setShops(shopList);
      setExecutives(execList);
      setNearbyDistributors(distList);
      setApprovals(appData.approvals || []);
      setBadges({
        executives: execList.length,
        shops:      shopList.length,
        delivery:   0,
      });
    } catch (err) {
      console.error('Regional dashboard load error:', err);
    }
  };

  useEffect(() => { refreshDashboard(); }, []);

  /* auto-open exec modal when navigated via sidebar */
  useEffect(() => {
    if (pathname === '/regional/create-executive') setExecModalOpen(true);
  }, [pathname]);

  /* ── Combined active + pending lists for detail pages ──
     Tables show everyone (with a Status tag); headline counts stay on the active total
     so they match the clickable overview card. Distributors have no pending entries in
     the Regional approvals queue, so that list is active-only. */
  const pendingShops = approvals.filter(a => a.role === 'SHOP');
  const pendingExecs = approvals.filter(a => a.role === 'EXECUTIVE');
  const shopsAll = [...shops, ...pendingShops];
  const execsAll = [...executives, ...pendingExecs];

  /* Shops nobody can find. Not a display concern: `rankCandidateShops` prefilters
     on `@@index([role, latitude, longitude])`, so a NULL-coordinate shop is
     matched by no customer's search, ever, and every other column on its row
     says it is trading normally. */
  const unplacedShops = shopsAll.filter(s => s.latitude == null || s.longitude == null);

  /* Subscription revenue derived from partner data (no backend field for this yet) */
  const subscribedShops      = shops.filter(s => s.monthlyCost);
  const shopSubsMonthly      = subscribedShops.reduce((sum, s) => sum + (s.monthlyCost || 0), 0);
  const distributorSubsMonthly = nearbyDistributors.reduce((sum, d) => sum + (d.monthlyCost || 0), 0);

  /* Per-category values for the overview "Revenue by Category" grid */
  const revCatValue = {
    partnerships: 0, // no partnership-fee data source yet
    shops:        shopSubsMonthly,
    distributors: distributorSubsMonthly,
  };

  /* Section header with a back-to-dashboard link (for routes not in the sidebar) */
  const renderPageHeader = (title, sub, right) => (
    <div className="section-header" style={{ marginBottom: '14px' }}>
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="section-sub">
          <a style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={() => navigate('/regional')}>‹ Dashboard</a>
          {sub ? <> · {sub}</> : null}
        </p>
      </div>
      {right}
    </div>
  );

  /* ── Submit executive ── */
  const handleExecSubmit = async (e) => {
    if (e) e.preventDefault();
    try {
      await createPartner({
        role:          'EXECUTIVE',
        name:          execForm.fullName,
        phone:         execForm.mobile,
        email:         execForm.email,
        regionName,
        stateName,
        districtName,
        industryId:    user.industryId,
        aadhaarNumber: execForm.aadhaar,
        panNumber:     execForm.pan,
        businessName:  execType,                   // SHOP_LISTING | DELIVERY_ONBOARDING
        bankName:      execForm.bankName,
        accountNumber: execForm.accountNumber,
        ifscCode:      execForm.ifscCode,
        accountType:   execForm.accountType,
        monthlyCost:   parseFloat(execForm.compensation) || 6000,
        password:      execForm.email || execForm.mobile || 'password123',
      });
      setExecModalOpen(false);
      setExecForm({
        fullName: '', mobile: '', email: '', dob: '',
        aadhaar: '', pan: '',
        target: '', compensation: '6000',
        bankName: '', accountNumber: '', ifscCode: '', accountType: 'Savings',
      });
      setExecType('SHOP_LISTING');
      await refreshDashboard();
    } catch (err) {
      console.error('Create executive error:', err);
    }
  };

  /* ── Exec card ── */
  const ExecCard = ({ exec, idx }) => {
    const colorPair = EXEC_AVATAR_COLORS[idx % EXEC_AVATAR_COLORS.length];
    const typeLabel = EXEC_TYPE_LABEL[exec.businessName] || 'Field Executive';
    return (
      <div className="exec-card">
        <div className="exec-avatar" style={{ background: colorPair.bg, color: colorPair.color }}>
          {initials(exec.name)}
        </div>
        <div className="exec-info">
          <div className="exec-name">{exec.name}</div>
          <div className="exec-meta" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {typeLabel} · {exec.regionName || regionName} ·&nbsp;
            <Tag text={exec.isActive ? 'Active' : 'Pending'} type={exec.isActive ? 'green' : 'amber'} />
          </div>
        </div>
        <div className="exec-stats">
          <div className="exec-stat">
            <div className="exec-stat-val">—</div>
            <div className="exec-stat-lbl">
              {exec.businessName === 'DELIVERY_ONBOARDING' ? 'Partners' : 'Shops Listed'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ── Onboarding a shop, with its pin ── */
  const handleShopSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!shopPin) {
      setShopError('Place the shop on the map first — without it no customer can find it.');
      return;
    }
    setShopError('');
    setShopSubmitting(true);
    try {
      await createPartner({
        role:            'SHOP',
        name:            shopForm.ownerName,
        phone:           shopForm.mobile,
        email:           shopForm.email,
        password:        shopForm.password,
        regionName,
        businessName:    shopForm.businessName,
        gstNumber:       shopForm.gstNumber,
        monthlyCost:     shopForm.monthlyCost ? parseFloat(shopForm.monthlyCost) : 0,
        latitude:        shopPin.latitude,
        longitude:       shopPin.longitude,
        serviceRadiusKm: shopForm.serviceRadiusKm || undefined
      });
      setShopModalOpen(false);
      setShopForm(defaultShopForm);
      setShopPin(null);
      refreshDashboard();
    } catch (err) {
      // The server's own message is the useful one — it names the field.
      setShopError(err?.response?.data?.message || 'Could not onboard this shop.');
    } finally {
      setShopSubmitting(false);
    }
  };

  /* ── Placing a shop that was onboarded without a pin ── */
  const openLocationEditor = (shop) => {
    setLocatingShop(shop);
    setLocationError('');
    setLocationPin(
      shop.latitude != null && shop.longitude != null
        ? { latitude: shop.latitude, longitude: shop.longitude }
        : null
    );
  };

  const saveLocation = async () => {
    if (!locationPin) return;
    setLocationSaving(true);
    setLocationError('');
    try {
      await setPartnerLocation(locatingShop.id, locationPin);
      setLocatingShop(null);
      refreshDashboard();
    } catch (err) {
      setLocationError(err?.response?.data?.message || 'Could not save this location.');
    } finally {
      setLocationSaving(false);
    }
  };

  /* ── Shop columns ── */
  const shopColumns = [
    { header: '#', render: (row, i) => <span style={{ color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{(i ?? 0) + 1}</span> },
    { header: 'Shop Name',   render: (row) => <div><div style={{ fontWeight: '500' }}>{row.name}</div></div> },
    { header: 'Category',    render: (row) => <Tag text={row.businessName || 'Shop'} type="teal" /> },
    // Not decoration. A shop without a pin is open, stocked, and unreachable by
    // every customer — this column is the only place that is ever visible.
    {
      header: 'Location',
      render: (row) => {
        const placed = row.latitude != null && row.longitude != null;
        return (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => openLocationEditor(row)}
            title={placed ? 'Move this shop on the map' : 'This shop cannot be found by any customer'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
              color: placed ? 'var(--text-muted)' : 'var(--danger, #c0392b)',
              fontWeight: placed ? 400 : 600
            }}
          >
            {placed ? <MapPin size={13} /> : <MapPinOff size={13} />}
            {placed ? 'On the map' : 'Not on the map'}
          </button>
        );
      }
    },
    { header: 'Subscription', render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent)' }}>{row.monthlyCost ? `₹${row.monthlyCost.toLocaleString('en-IN')}/mo` : '—'}</span> },
    { header: 'Status',      render: (row) => <Tag text={row.isActive ? 'Active' : 'Pending'} type={row.isActive ? 'green' : 'amber'} /> },
  ];

  /* ── Delivery partner columns (empty — no delivery role in system) ── */
  const deliveryColumns = [
    { header: 'Partner Name', render: (row) => <div style={{ fontWeight: '500' }}>{row.name}</div> },
    { header: 'Vehicle Type', render: (row) => <Tag text={row.businessName || '—'} type="amber" /> },
    { header: 'Onboarded By', render: () => <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span> },
    { header: 'Deliveries (Mo)', render: () => <span style={{ fontFamily: 'DM Mono, monospace' }}>—</span> },
    { header: 'Status', render: () => <Tag text="Active" type="green" /> },
  ];

  /* ── Render content ── */
  const renderContent = () => {
    switch (pathname) {

      /* ── REVENUE ── */
      case '/regional/revenue':
        return (
          <>
            <div className="subview-header">
              <div>
                <h2 className="subview-title">Revenue Summary — {regionName} · {industryName}</h2>
                <p className="subview-subtitle">Full breakdown of your region's revenue and your earnings</p>
              </div>
            </div>

            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Revenue Category</th>
                      <th style={{ textAlign: 'right' }}>Total in Region</th>
                      <th style={{ textAlign: 'right' }}>My Share %</th>
                      <th style={{ textAlign: 'right' }}>My Earnings</th>
                      <th style={{ textAlign: 'right' }}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REV_CATEGORIES.map((cat, idx) => (
                      <tr key={idx}>
                        <td>{cat.emoji} {cat.label}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>—</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--brand)' }}>{cat.sharePct}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--accent)', fontWeight: '600' }}>—</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)' }}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '24px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  Total Region Revenue:&nbsp;
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '600', color: 'var(--brand)' }}>
                    {formatRupees(stats.regionalRevenue || 0)}
                  </span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  My Earnings:&nbsp;
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '700', fontSize: '15px', color: 'var(--accent)' }}>
                    {formatRupees(stats.myShare || 0)}
                  </span>
                </span>
              </div>
            </div>
          </>
        );

      /* ── ALL EXECUTIVES ── */
      case '/regional/executives':
        return (
          <>
            {renderPageHeader(
              `All Executives — ${regionName}`,
              'Shop listing & delivery onboarding executives in your region',
              <button className="btn btn-primary btn-sm" onClick={() => setExecModalOpen(true)}>
                <Plus size={12} /> Add Executive
              </button>
            )}
            <div className="full-col">
              {execsAll.length === 0 ? (
                <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No executives yet — create the first one.
                </div>
              ) : (
                execsAll.map((exec, idx) => <ExecCard key={exec.id} exec={exec} idx={idx} />)
              )}
            </div>
          </>
        );

      /* ── REGISTERED SHOPS ── */
      case '/regional/shops':
        return (
          <>
            {renderPageHeader(
              `Registered Shops — ${regionName}`,
              'All shops listed in your region by your executives',
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Tag text={`${shops.length} Active`} type="teal" />
                <button className="btn btn-primary btn-sm" onClick={() => setShopModalOpen(true)}>
                  <Plus size={12} /> Add Shop
                </button>
              </div>
            )}

            {/* The count that matters most on this page, and the only place it
                shows: an unplaced shop is trading-ready in every other column. */}
            {unplacedShops.length > 0 && (
              <div
                className="card full-col"
                style={{ borderLeft: '3px solid var(--danger, #c0392b)', marginBottom: 12 }}
              >
                <div className="card-body" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <MapPinOff size={16} style={{ color: 'var(--danger, #c0392b)', flexShrink: 0 }} />
                  <div style={{ fontSize: 13 }}>
                    <strong>{unplacedShops.length} shop{unplacedShops.length > 1 ? 's are' : ' is'} not on the map.</strong>{' '}
                    No customer can find {unplacedShops.length > 1 ? 'them' : 'it'}, however well stocked and
                    however open. Set the location from the Location column below.
                  </div>
                </div>
              </div>
            )}

            <div className="card full-col">
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={shopColumns} data={shopsAll} />
              </div>
            </div>
          </>
        );

      /* ── DELIVERY PARTNERS ── */
      case '/regional/delivery-partners':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Delivery Partners — {regionName}</h2>
                <p className="section-sub">Active delivery partners onboarded by your executives</p>
              </div>
              <Tag text="0 Riders" type="amber" />
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={deliveryColumns} data={[]} />
            </div>
          </div>
        );

      /* ── DISTRIBUTORS ── */
      case '/regional/distributors':
        return (
          <>
            <div className="subview-header" style={{ marginBottom: '16px' }}>
              <div>
                <h2 className="subview-title">Nearby Distributors</h2>
                <p className="subview-subtitle">Supply chain hubs serving the {regionName} region</p>
              </div>
            </div>
            {nearbyDistributors.length === 0 ? (
              <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No distributors mapped to this region yet.
              </div>
            ) : (
              <div className="stat-grid">
                {nearbyDistributors.map((dist) => (
                  <div key={dist.id} className="card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div>
                        <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>{dist.name}</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          <MapPin size={12} /> {dist.regionName || regionName}
                        </div>
                      </div>
                      <Tag text="Active" type="green" />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '700', fontFamily: 'DM Mono, monospace', color: 'var(--brand)' }}>
                          {dist.businessName || dist.gstNumber ? '—' : '—'}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Products</div>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{dist.businessName || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        );

      /* ── MY EARNINGS ── */
      case '/regional/earnings':
        return (
          <>
            {renderPageHeader('My Earnings Breakdown', `Your 40% regional share across all revenue categories — ${regionName}`)}
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="My Total Earnings"  value={formatRupees(stats.myShare || 0)}        delta="Regional partner share" isUp={true} color="green" />
              <StatCard label="Region Revenue Base" value={formatRupees(stats.regionalRevenue || 0)} delta="All region revenue"      isUp={true} color="amber" />
              <StatCard label="My Share Rate"        value="40%"                                     delta="Of platform fee"        isUp={true} color="blue" />
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Revenue Category</th>
                      <th style={{ textAlign: 'right' }}>Total in Region</th>
                      <th style={{ textAlign: 'right' }}>My Share %</th>
                      <th style={{ textAlign: 'right' }}>My Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REV_CATEGORIES.map((cat, idx) => (
                      <tr key={idx}>
                        <td>{cat.emoji} {cat.label}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>—</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--brand)' }}>{cat.sharePct}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--accent)', fontWeight: '600' }}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '24px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Region Revenue:&nbsp;
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '600', color: 'var(--brand)' }}>{formatRupees(stats.regionalRevenue || 0)}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>My Earnings:&nbsp;
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '700', fontSize: '15px', color: 'var(--accent)' }}>{formatRupees(stats.myShare || 0)}</span>
                </span>
              </div>
            </div>
          </>
        );

      /* ── SHOP SUBSCRIPTIONS ── */
      case '/regional/shop-subscriptions':
        return (
          <>
            {renderPageHeader('Shop Subscriptions', `Subscription revenue from retail shops in ${regionName}`)}
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Subscribed Shops"        value={String(subscribedShops.length)}    delta={`${shops.length} total shops`} isUp={true} color="teal" />
              <StatCard label="Monthly Subscription"    value={formatRupees(shopSubsMonthly)}     delta="Recurring revenue"            isUp={true} color="green" />
              <StatCard label="Annual Projection"       value={formatRupees(shopSubsMonthly * 12)} delta="12 × monthly"                isUp={true} color="amber" />
            </div>
            <div className="card full-col">
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={shopColumns} data={shopsAll} />
              </div>
            </div>
          </>
        );

      /* ── OVERVIEW (default — also handles /regional/create-executive) ── */
      default:
        return (
          <>
            {/* Stats Row 1 */}
            <div className="stat-grid">
              <StatCard
                label="Region Revenue"
                value={formatRupees(stats.regionalRevenue || 0)}
                delta={stats.regionalRevenue ? '↑ this month' : 'No orders yet'}
                isUp={true}
                color="amber"
                onClick={() => navigate('/regional/revenue')}
                title="View revenue summary"
              />
              <StatCard
                label="My Share (40%)"
                value={formatRupees(stats.myShare || 0)}
                delta="Earned this month"
                isUp={true}
                color="green"
                onClick={() => navigate('/regional/earnings')}
                title="View my earnings"
              />
              <StatCard
                label="Registered Shops"
                value={(stats.registeredShops ?? shops.length).toString()}
                delta="↑ retail shops active"
                isUp={true}
                color="teal"
                onClick={() => navigate('/regional/shops')}
                title="View registered shops"
              />
              <StatCard
                label="Delivery Partners"
                value="0"
                delta="Riders mapped"
                isUp={true}
                color="blue"
                onClick={() => navigate('/regional/delivery-partners')}
                title="View delivery partners"
              />
            </div>

            {/* Stats Row 2 */}
            <div className="stat-grid">
              <StatCard
                label="Executives (Active)"
                value={(stats.activeRiders ?? executives.length).toString()}
                delta="Shop listing & delivery"
                isUp={true}
                color="purple"
                onClick={() => navigate('/regional/executives')}
                title="View all executives"
              />
              <StatCard
                label="Distributors Nearby"
                value={nearbyDistributors.length.toString()}
                delta="Mapped to your region"
                isUp={true}
                color="amber"
                onClick={() => navigate('/regional/distributors')}
                title="View nearby distributors"
              />
              <StatCard
                label="Shop Subscriptions"
                value={formatRupees(shopSubsMonthly)}
                delta={`${subscribedShops.length} shops · monthly`}
                isUp={true}
                color="green"
                onClick={() => navigate('/regional/shop-subscriptions')}
                title="View shop subscriptions"
              />
              {/* The rider-subscription card is gone (2026-08-07): riders are
                  independent delivery partners the platform pays per order, so
                  there is no subscription to collect from them. */}
              <StatCard
                label="Delivery Partners"
                value={String(badges.delivery)}
                delta="Onboarded in region"
                isUp={true}
                color="teal"
                onClick={() => navigate('/regional/delivery-partners')}
                title="View delivery partners"
              />
            </div>

            {/* Revenue by Category */}
            <div className="section-header">
              <div>
                <h2 className="section-title">Revenue by Category — {regionName}</h2>
              </div>
            </div>
            <div className="rev-cat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '20px' }}>
              {REV_CAT_CARDS.map((cat, idx) => (
                <div key={idx} className="rev-cat-card" onClick={() => navigate(cat.to)} style={{ cursor: 'pointer' }} title={`View ${cat.name}`}>
                  <div className="rev-cat-icon" style={{ background: cat.bg }}>{cat.emoji}</div>
                  <div className="rev-cat-name">{cat.name}</div>
                  <div className="rev-cat-value" style={{ color: cat.color }}>{formatRupees(revCatValue[cat.key])}</div>
                </div>
              ))}
            </div>

            {/* My Executives */}
            <div className="section-header">
              <div>
                <h2 className="section-title">My Executives</h2>
                <p className="section-sub">
                  Shop listing &amp; delivery onboarding executives you've created — pending district approval
                </p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setExecModalOpen(true)}>
                <Plus size={11} /> Add Executive
              </button>
            </div>

            <div className="info-box amber" style={{ marginBottom: '14px' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="8" cy="8" r="6" stroke="#78350F" strokeWidth="1.4" />
                <path d="M8 7v4" stroke="#78350F" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>
                Executives you create go to District Partner for approval before they can begin onboarding
                shops and delivery partners in {regionName}. Approved executives report to you directly.
              </span>
            </div>

            <div className="full-col" style={{ marginBottom: '20px' }}>
              {executives.length === 0 ? (
                <div className="card" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No executives yet — create the first one.
                </div>
              ) : (
                executives.slice(0, 4).map((exec, idx) => (
                  <ExecCard key={exec.id} exec={exec} idx={idx} />
                ))
              )}
            </div>

            {/* Top Shops */}
            <div className="section-header">
              <div>
                <h2 className="section-title">Top Shops — {regionName}</h2>
                <p className="section-sub">Best performing auto shops in your region this month</p>
              </div>
              <Tag text={`${shops.length} Shops`} type="teal" />
            </div>
            <div className="card full-col">
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable
                  columns={shopColumns}
                  data={shops.slice(0, 5)}
                />
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <DashboardLayout
      role="REGIONAL"
      badges={badges}
      onLogout={onLogout}
      title="Regional Partner Dashboard"
      subtitle={`${regionName || 'Your'} Region · ${industryName} Operations`}
      locationChain={[
        { type: 'state',  label: stateName    || 'State'    },
        { type: 'ind',    label: industryName              },
        { type: 'dist',   label: districtName || 'District' },
        { type: 'region', label: regionName   || 'Region'   },
      ]}
      actionButton={
        <button className="btn btn-primary" onClick={() => setExecModalOpen(true)}>
          <Plus size={14} /> Create Executive
        </button>
      }
    >
      <div className="content">
        {renderContent()}
      </div>

      {/* ── CREATE EXECUTIVE PROFILE MODAL ── */}
      <Modal
        isOpen={execModalOpen}
        onClose={() => setExecModalOpen(false)}
        title="Create Executive Profile"
        subtitle={`Add a shop listing or delivery onboarding executive for ${regionName}`}
        width="700px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setExecModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleExecSubmit}>Submit for Approval</button>
          </>
        }
      >
        {/* Executive Type Selector */}
        <h3 className="form-section-title">Executive Type</h3>
        <div className="type-selector">
          <div
            className={`type-option${execType === 'SHOP_LISTING' ? ' selected' : ''}`}
            onClick={() => setExecType('SHOP_LISTING')}
          >
            <div className="type-option-icon">🏪</div>
            <div className="type-option-title">Shop Listing Executive</div>
            <div className="type-option-desc">Visits shops, lists them on the platform, collects subscription</div>
          </div>
          <div
            className={`type-option${execType === 'DELIVERY_ONBOARDING' ? ' selected' : ''}`}
            onClick={() => setExecType('DELIVERY_ONBOARDING')}
          >
            <div className="type-option-icon">🚚</div>
            <div className="type-option-title">Delivery Partner Executive</div>
            <div className="type-option-desc">Onboards delivery partners, manages their subscription</div>
          </div>
        </div>

        {/* Info box */}
        <div className="info-box amber" style={{ marginBottom: '14px' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="8" cy="8" r="6" stroke="#78350F" strokeWidth="1.4" />
            <path d="M8 7v4" stroke="#78350F" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>
            Exec profiles you create go to {districtName} District Partner for approval. Once approved,
            the executive gets access to the RoadMate Executive App for their assigned type.
          </span>
        </div>

        {/* Personal Details */}
        <h3 className="form-section-title">Personal Details</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Full Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="Executive's full name"
              value={execForm.fullName}
              onChange={e => setExecForm({ ...execForm, fullName: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="tel" className="form-input" placeholder="+91 XXXXX XXXXX"
              value={execForm.mobile}
              onChange={e => setExecForm({ ...execForm, mobile: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email" className="form-input" placeholder="executive@example.com"
              value={execForm.email}
              onChange={e => setExecForm({ ...execForm, email: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              type="date" className="form-input"
              value={execForm.dob}
              onChange={e => setExecForm({ ...execForm, dob: e.target.value })}
            />
          </div>
        </div>

        {/* Aadhaar + PAN */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Aadhaar Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="XXXX XXXX XXXX" maxLength={14}
              value={execForm.aadhaar}
              onChange={e => setExecForm({ ...execForm, aadhaar: e.target.value })}
            />
            <div className="upload-zone" style={{ marginTop: '6px' }}>
              🪪 Upload Aadhaar
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">PAN Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="ABCDE1234F" maxLength={10}
              style={{ textTransform: 'uppercase' }}
              value={execForm.pan}
              onChange={e => setExecForm({ ...execForm, pan: e.target.value.toUpperCase() })}
            />
            <div className="upload-zone" style={{ marginTop: '6px' }}>
              🪪 Upload PAN
            </div>
          </div>
        </div>

        {/* Assignment Details */}
        <div className="form-divider" />
        <h3 className="form-section-title">Assignment Details</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Region</label>
            <input
              type="text" className="form-input"
              value={regionName}
              readOnly style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Industry</label>
            <input
              type="text" className="form-input"
              value={industryName}
              readOnly style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Target per Month <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="number" className="form-input"
              placeholder={execType === 'SHOP_LISTING' ? 'e.g. 10 shops' : 'e.g. 15 delivery partners'}
              value={execForm.target}
              onChange={e => setExecForm({ ...execForm, target: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Monthly Compensation</label>
            <select
              className="form-select"
              value={execForm.compensation}
              onChange={e => setExecForm({ ...execForm, compensation: e.target.value })}
            >
              <option value="6000">₹6,000/month (Base)</option>
              <option value="7500">₹7,500/month (Standard)</option>
              <option value="8000">₹8,000/month (Premium)</option>
            </select>
          </div>
        </div>

        {/* Bank Details */}
        <div className="form-divider" />
        <h3 className="form-section-title">Bank Details</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Bank Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <select
              className="form-select"
              value={execForm.bankName}
              onChange={e => setExecForm({ ...execForm, bankName: e.target.value })}
            >
              <option value="">Select Bank</option>
              <option>State Bank of India</option>
              <option>HDFC Bank</option>
              <option>ICICI Bank</option>
              <option>Axis Bank</option>
              <option>Other</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Account Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="Account number"
              value={execForm.accountNumber}
              onChange={e => setExecForm({ ...execForm, accountNumber: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">IFSC Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="SBIN0001234"
              value={execForm.ifscCode}
              onChange={e => setExecForm({ ...execForm, ifscCode: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Account Type</label>
            <select
              className="form-select"
              value={execForm.accountType}
              onChange={e => setExecForm({ ...execForm, accountType: e.target.value })}
            >
              <option value="Savings">Savings Account</option>
              <option value="Current">Current Account</option>
            </select>
          </div>
        </div>

        {/* Documents */}
        <div className="form-divider" />
        <h3 className="form-section-title">Documents</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Photo <span style={{ color: 'var(--red)' }}>*</span></label>
            <div className="upload-zone">📷 Upload Passport Photo</div>
          </div>
          <div className="form-group">
            <label className="form-label">Address Proof <span style={{ color: 'var(--red)' }}>*</span></label>
            <div className="upload-zone">📋 Upload Address Proof</div>
          </div>
        </div>
      </Modal>

      {/* ── ONBOARD A SHOP (PHASE A.1) ──
          The pin is not an optional extra on this form. `POST /api/partners/create`
          refuses a SHOP without one, and it is right to: a shop onboarded without
          coordinates is open, stocked, subscribed and invisible. */}
      <Modal
        isOpen={shopModalOpen}
        onClose={() => setShopModalOpen(false)}
        title="Add Shop"
        subtitle={`List a retail shop in ${regionName}`}
        width="760px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setShopModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleShopSubmit} disabled={shopSubmitting}>
              {shopSubmitting ? 'Submitting…' : 'Submit for Approval'}
            </button>
          </>
        }
      >
        <h3 className="form-section-title">Shop &amp; Owner</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Shop Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="e.g. Sree Krishna Stores"
              value={shopForm.businessName}
              onChange={e => setShopForm({ ...shopForm, businessName: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Owner Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text" className="form-input" placeholder="Owner's full name"
              value={shopForm.ownerName}
              onChange={e => setShopForm({ ...shopForm, ownerName: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            {/* Also the sign-in identifier — `src/lib/phone.js` normalises it and
                the server refuses a malformed one rather than storing it unusable. */}
            <input
              type="tel" className="form-input" placeholder="+91 XXXXX XXXXX"
              value={shopForm.mobile}
              onChange={e => setShopForm({ ...shopForm, mobile: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email Address <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="email" className="form-input" placeholder="shop@example.com"
              value={shopForm.email}
              onChange={e => setShopForm({ ...shopForm, email: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Temporary Password</label>
            <input
              type="text" className="form-input" placeholder="Leave blank for the default"
              value={shopForm.password}
              onChange={e => setShopForm({ ...shopForm, password: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">GST Number</label>
            <input
              type="text" className="form-input" placeholder="29ABCDE1234F1Z5"
              value={shopForm.gstNumber}
              onChange={e => setShopForm({ ...shopForm, gstNumber: e.target.value })}
            />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">
          Where the shop is <span style={{ color: 'var(--red)' }}>*</span>
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 10 }}>
          Customers are matched to shops by distance and riders are sent to this exact point.
          A shop with no location is never shown to anybody.
        </p>
        <LocationPicker
          value={shopPin}
          onChange={setShopPin}
          radiusKm={parseFloat(shopForm.serviceRadiusKm) || null}
        />

        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label className="form-label">Delivery Radius (km)</label>
            <input
              type="number" className="form-input" min="0.5" max="50" step="0.5"
              value={shopForm.serviceRadiusKm}
              onChange={e => setShopForm({ ...shopForm, serviceRadiusKm: e.target.value })}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              How far the platform will route this shop's orders. Blank uses the platform default.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Monthly Subscription (₹)</label>
            <input
              type="number" className="form-input" placeholder="3000"
              value={shopForm.monthlyCost}
              onChange={e => setShopForm({ ...shopForm, monthlyCost: e.target.value })}
            />
          </div>
        </div>

        {shopError && (
          <div className="info-box" style={{ marginTop: 12, color: 'var(--danger, #c0392b)' }}>
            {shopError}
          </div>
        )}
      </Modal>

      {/* ── PLACE AN EXISTING SHOP ──
          The repair route for shops onboarded before coordinates were captured.
          They cannot fix themselves unless they already know to look in the Shop
          app, and nothing else in the product reports them as missing. */}
      <Modal
        isOpen={!!locatingShop}
        onClose={() => setLocatingShop(null)}
        title={locatingShop ? `Location — ${locatingShop.name}` : 'Location'}
        subtitle="Drag the pin to the shop's front door. This is where the rider is sent."
        width="700px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setLocatingShop(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={saveLocation}
              disabled={!locationPin || locationSaving}
            >
              {locationSaving ? 'Saving…' : 'Save Location'}
            </button>
          </>
        }
      >
        <LocationPicker
          value={locationPin}
          onChange={setLocationPin}
          radiusKm={locatingShop?.serviceRadiusKm ?? null}
        />
        {locationError && (
          <div className="info-box" style={{ marginTop: 12, color: 'var(--danger, #c0392b)' }}>
            {locationError}
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default RegionalDashboard;
