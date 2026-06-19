import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StatCard from '../components/ui/StatCard';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Tag from '../components/ui/Tag';
import { Plus, Check, X } from 'lucide-react';
import {
  getOverviewStats,
  getPendingApprovals,
  getActivePartners,
  approvePartner,
  rejectPartner,
  createPartner,
  getIndustries
} from '../utils/api';

// ── Helpers ──
const formatRupees = (amount) => {
  const n = parseFloat(amount) || 0;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `₹${n.toLocaleString('en-IN')}`;
  return `₹${n}`;
};

const fmtDate = (iso) => (iso ? iso.split('T')[0] : '—');

const ROLE_LABELS = {
  IND_STATE: 'Industry State Partner',
  DISTRICT:  'District Partner',
  REGIONAL:  'Regional Partner',
  SHOP:      'Shop Owner',
  EXECUTIVE: 'Field Executive'
};

const roleTagColor = (role) => {
  if (role === 'REGIONAL')  return 'amber';
  if (role === 'DISTRICT')  return 'teal';
  if (role === 'IND_STATE') return 'purple';
  return 'blue';
};

// Revenue category display config (static — no per-category backend breakdown)
const REV_CATEGORIES = [
  { emoji: '🤝', name: 'Partnerships',           bg: '#EFF4FF', color: 'var(--blue)'   },
  { emoji: '🏪', name: 'Shop Subscriptions',     bg: '#E8F4EF', color: 'var(--accent)' },
  { emoji: '🚚', name: 'Delivery Subscriptions', bg: '#ECFEFF', color: 'var(--teal)'   },
  { emoji: '📦', name: 'Distributor Subs',       bg: '#FEF3C7', color: 'var(--amber)'  },
  { emoji: '🏭', name: 'Manufacturer Subs',      bg: '#F5F3FF', color: 'var(--purple)' },
];

const StateDashboard = ({ onLogout }) => {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();

  // Get logged-in user from localStorage
  const currentUser = JSON.parse(localStorage.getItem('roadmate_user') || '{}');
  const stateName   = currentUser.stateName || 'Your State';
  const userName    = currentUser.name      || 'State Partner';

  // ── Server-driven state ──
  const [stats, setStats] = useState({
    stateRevenue: 0, myShare: 0, activeIndustryPartners: 0, pendingApprovals: 0,
    districtPartners: 0, regionalPartners: 0, registeredShops: 0, deliveryRiders: 0
  });
  const [approvals,            setApprovals]            = useState([]);
  const [industryPartners,     setIndustryPartners]     = useState([]);
  const [districtPartners,     setDistrictPartners]     = useState([]);
  const [regionalPartners,     setRegionalPartners]     = useState([]);
  const [shopPartners,         setShopPartners]         = useState([]);
  const [executives,           setExecutives]           = useState([]);
  const [industries,           setIndustries]           = useState([]);
  const [loading,              setLoading]              = useState(true);
  const [badges,               setBadges]               = useState({ approvals: 0 });

  // ── Modal ──
  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);

  // ── Form ──
  const defaultForm = {
    industry: '', fullName: '', mobile: '', email: '', dob: '',
    businessName: '', gstNumber: '', aadhaarNumber: '', panNumber: '',
    maintenanceCost: '',
    bankName: '', accountHolder: '', accountNumber: '', ifscCode: '',
    accountType: 'Current', upiId: ''
  };
  const [partnerForm,  setPartnerForm]  = useState(defaultForm);
  const [submitting,   setSubmitting]   = useState(false);

  // File refs (visual only)
  const aadhaarRef   = useRef(null);
  const panRef       = useRef(null);
  const agreementRef = useRef(null);
  const chequeRef    = useRef(null);
  const [aadhaarName,   setAadhaarName]   = useState('Upload Aadhaar Card — PDF / JPG');
  const [panName,       setPanName]       = useState('Upload PAN Card — PDF / JPG');
  const [agreementName, setAgreementName] = useState('Click to upload or drag & drop');
  const [chequeName,    setChequeName]    = useState('Attach cancelled cheque (PDF / JPG)');

  // ── Data fetch ──
  const refreshDashboard = async () => {
    setLoading(true);
    try {
      const [statsRes, approvalsRes, partnersRes, industriesRes] = await Promise.all([
        getOverviewStats(),
        getPendingApprovals(),
        getActivePartners(),
        getIndustries()
      ]);

      if (statsRes.status === 'success')     setStats(statsRes.stats);
      if (approvalsRes.status === 'success') {
        setApprovals(approvalsRes.approvals);
        setBadges({ approvals: approvalsRes.approvals.length });
      }
      if (partnersRes.status === 'success') {
        const all = partnersRes.partners || [];
        setIndustryPartners(all.filter(p => p.role === 'IND_STATE'));
        setDistrictPartners(all.filter(p => p.role === 'DISTRICT'));
        setRegionalPartners(all.filter(p => p.role === 'REGIONAL'));
        setShopPartners(all.filter(p => p.role === 'SHOP'));
        setExecutives(all.filter(p => p.role === 'EXECUTIVE'));
      }
      if (industriesRes.status === 'success') setIndustries(industriesRes.industries || []);
    } catch (err) {
      console.error('StateDashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshDashboard(); }, []);

  // ── Handlers ──
  const handleApprove = async (id) => {
    try {
      await approvePartner(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
      setBadges(prev => ({ approvals: Math.max(0, prev.approvals - 1) }));
    } catch (err) { console.error('Approve error:', err); }
  };

  const handleReject = async (id) => {
    try {
      await rejectPartner(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
      setBadges(prev => ({ approvals: Math.max(0, prev.approvals - 1) }));
    } catch (err) { console.error('Reject error:', err); }
  };

  const handlePartnerSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setSubmitting(true);
    try {
      // Match industry name to id
      const matched = industries.find(i =>
        i.name.toLowerCase().includes(partnerForm.industry.toLowerCase().replace(/^[^\w]+/, ''))
      );
      await createPartner({
        role: 'IND_STATE',
        name: partnerForm.fullName,
        email: partnerForm.email,
        phone: partnerForm.mobile,
        industryId: matched ? matched.id : undefined,
        businessName: partnerForm.businessName,
        gstNumber: partnerForm.gstNumber,
        aadhaarNumber: partnerForm.aadhaarNumber,
        panNumber: partnerForm.panNumber,
        monthlyCost: partnerForm.maintenanceCost ? parseFloat(partnerForm.maintenanceCost) : 0,
        bankName: partnerForm.bankName,
        accountHolder: partnerForm.accountHolder,
        accountNumber: partnerForm.accountNumber,
        ifscCode: partnerForm.ifscCode,
        accountType: partnerForm.accountType,
        upiId: partnerForm.upiId
      });
      setIsPartnerModalOpen(false);
      setPartnerForm(defaultForm);
      setAadhaarName('Upload Aadhaar Card — PDF / JPG');
      setPanName('Upload PAN Card — PDF / JPG');
      setAgreementName('Click to upload or drag & drop');
      setChequeName('Attach cancelled cheque (PDF / JPG)');
      refreshDashboard();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to create partner. Please try again.');
      console.error('Create IND_STATE error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Column definitions ──
  const approvalColumns = [
    {
      header: "Partner Details",
      render: (row) => {
        const loc = [row.regionName, row.districtName, row.stateName].filter(Boolean).join(' · ');
        const initials = (row.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
              {initials}
            </div>
            <div>
              <div className="approval-name">{row.name}</div>
              <div className="approval-meta">{loc || row.industry?.name || '—'}</div>
            </div>
          </div>
        );
      }
    },
    {
      header: "Type",
      render: (row) => <Tag text={ROLE_LABELS[row.role] || row.role} type={roleTagColor(row.role)} />
    },
    {
      header: "Applied Date",
      render: (row) => <span className="mono">{fmtDate(row.createdAt)}</span>
    },
    {
      header: "Actions",
      cellStyle: { textAlign: 'right' },
      render: (row) => (
        <div className="approval-actions" style={{ justifyContent: 'flex-end' }}>
          <button className="btn-approve" onClick={() => handleApprove(row.id)}>
            <Check size={12} style={{ marginRight: '4px', display: 'inline' }} /> Approve
          </button>
          <button className="btn-reject" onClick={() => handleReject(row.id)}>
            <X size={12} style={{ marginRight: '4px', display: 'inline' }} /> Reject
          </button>
        </div>
      )
    }
  ];

  const partnerColumns = [
    {
      header: "Industry Partner Name",
      render: (row) => {
        const initials = (row.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="approval-avatar" style={{ background: 'var(--surface2)', color: 'var(--text-primary)' }}>
              {initials}
            </div>
            <div style={{ fontWeight: '500' }}>{row.name}</div>
          </div>
        );
      }
    },
    {
      header: "Industry Category",
      render: (row) => <Tag text={row.industry?.name || '—'} type="purple" />
    },
    {
      header: "Status",
      render: (row) => <Tag text={row.isActive ? 'Active' : 'Pending'} type={row.isActive ? 'green' : 'amber'} />
    }
  ];

  // ── Sub-page renderers ──
  const getSubtitle = () => {
    switch (pathname) {
      case '/state':          return `${stateName} Regional Hub Governance`;
      case '/state/revenue':  return `Complete revenue breakdown for ${stateName}`;
      case '/state/approvals': return `Regional & District partner profiles awaiting approval`;
      case '/state/partners': return `Onboard a new Industry State Partner`;
      case '/state/districts': return `All district partners in ${stateName}`;
      case '/state/regions':  return `All regional partners in ${stateName}`;
      case '/state/industries': return `Active industries in ${stateName}`;
      case '/state/earnings':  return `My 10% earnings breakdown for ${stateName}`;
      case '/state/shops':     return `All registered shops in ${stateName}`;
      case '/state/delivery':  return `All delivery partners in ${stateName}`;
      default: return `${stateName} Regional Hub Governance`;
    }
  };

  const getActionButton = () => {
    switch (pathname) {
      case '/state':
      case '/state/partners':
        return (
          <button className="btn btn-primary" onClick={() => setIsPartnerModalOpen(true)}>
            <Plus size={14} /> Industry State Partner
          </button>
        );
      case '/state/approvals':
        return <span className="pending-count">⚠ {approvals.length} Pending</span>;
      default:
        return null;
    }
  };

  // Approval cards split by role (overview page)
  const regionalApprovals  = approvals.filter(a => a.role === 'REGIONAL');
  const districtApprovalsL = approvals.filter(a => a.role === 'DISTRICT');
  const industryApprovals  = approvals.filter(a => a.role === 'IND_STATE');

  // ── Combined active + pending lists for the detail pages ──
  // Page tables show everyone (with a Status column); the headline Tag stays on the
  // active count so it matches the clickable overview card. Shops/executives have no
  // pending entries in the State approvals queue, so those lists are active-only.
  const industriesAll = [...industryPartners, ...industryApprovals];
  const districtsAll  = [...districtPartners, ...districtApprovalsL];
  const regionsAll    = [...regionalPartners, ...regionalApprovals];

  const statusTag = (row) => (
    <Tag text={row.isActive ? 'Active' : 'Pending'} type={row.isActive ? 'green' : 'amber'} />
  );
  const avatarCell = (row, bg, color) => {
    const initials = (row.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div className="approval-avatar" style={{ background: bg, color }}>{initials}</div>
        <div style={{ fontWeight: '500' }}>{row.name}</div>
      </div>
    );
  };

  // Page header with a back-to-dashboard link (for routes not in the sidebar)
  const pageBackHeader = (title, sub, tag) => (
    <div className="card-header">
      <div>
        <div className="section-title">{title}</div>
        <div className="section-sub">
          <a style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={() => navigate('/state')}>‹ Dashboard</a>
          {sub ? <> · {sub}</> : null}
        </div>
      </div>
      {tag}
    </div>
  );

  const renderContent = () => {
    switch (pathname) {

      // ── Revenue Summary ──
      case '/state/revenue':
        return (
          <div className="full-col">
            <div className="section-header" style={{ marginBottom: '16px' }}>
              <div>
                <div className="section-title">Revenue Summary — {stateName}</div>
                <div className="section-sub">Complete breakdown from all industries, districts, regions and revenue categories</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <div className="section-title" style={{ fontSize: '13px' }}>By Revenue Category</div>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th>Revenue Category</th>
                      <th style={{ textAlign: 'right' }}>Total Collected</th>
                      <th style={{ textAlign: 'right' }}>My Share %</th>
                      <th style={{ textAlign: 'right' }}>My Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REV_CATEGORIES.map((cat, i) => (
                      <tr key={i}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span>{cat.emoji}</span> {cat.name}</div></td>
                        <td className="mono" style={{ textAlign: 'right' }}>—</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--blue)' }}>10%</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '24px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total State Revenue: <span className="mono" style={{ fontWeight: 600, color: 'var(--blue)' }}>{formatRupees(stats.stateRevenue)}</span></span>
                <span style={{ color: 'var(--text-muted)' }}>My Earnings: <span className="mono" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--accent)' }}>{formatRupees(stats.myShare)}</span></span>
              </div>
            </div>
          </div>
        );

      // ── Full Approvals Page ──
      case '/state/approvals':
        return (
          <div className="full-col">
            <div className="section-header" style={{ marginBottom: '12px' }}>
              <div>
                <div className="section-title">All Pending Approvals — {stateName}</div>
                <div className="section-sub">Regional and District partner profiles awaiting your state-level approval</div>
              </div>
              <span className="pending-count">⚠ {approvals.length} Pending</span>
            </div>
            <div className="info-box" style={{ marginBottom: '16px' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="8" cy="8" r="6" stroke="#2563EB" strokeWidth="1.4"/><path d="M8 7v4" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round"/></svg>
              <span>As State Partner, you approve Regional and District Partner profiles. After your approval, these go to Master for final approval. Industry State Partner profiles are approved by Master directly.</span>
            </div>
            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable columns={approvalColumns} data={approvals} emptyMessage="No pending approvals for your state. All caught up!" />
              </div>
            </div>
          </div>
        );

      // ── Districts sub-page ──
      case '/state/districts':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Total District Partners" value={String(stats.districtPartners || 0)} delta="Active in your state" isUp={true} color="teal" />
              <StatCard label="Total Regional Partners" value={String(stats.regionalPartners || 0)} delta="Across all districts" isUp={true} color="amber" />
              <StatCard label="Registered Shops"        value={String(stats.registeredShops || 0)}  delta="In your state"       isUp={true} color="green" />
              <StatCard label="Delivery Riders"         value={String(stats.deliveryRiders || 0)}   delta="Active riders"       isUp={true} color="blue" />
            </div>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="section-title">District Partners — {stateName}</div>
                  <div className="section-sub">All active district-level partners in your state</div>
                </div>
                <Tag text={`${districtPartners.length} Districts`} type="teal" />
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable
                  columns={[
                    { header: "District Partner", render: (row) => {
                      const initials = (row.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
                      return <div style={{display:'flex',alignItems:'center',gap:'10px'}}><div className="approval-avatar" style={{background:'var(--teal-light)',color:'var(--teal)'}}>{initials}</div><div style={{fontWeight:'500'}}>{row.name}</div></div>;
                    }},
                    { header: "District",  accessor: "districtName" },
                    { header: "Industry",  render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
                    { header: "Status",    render: statusTag }
                  ]}
                  data={districtsAll}
                  emptyMessage="No district partners in your state yet."
                />
              </div>
            </div>
          </div>
        );

      // ── Regions sub-page ──
      case '/state/regions':
        return (
          <div className="full-col">
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="section-title">Regional Partners — {stateName}</div>
                  <div className="section-sub">All active regional partners in your state</div>
                </div>
                <Tag text={`${regionalPartners.length} Regions`} type="amber" />
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable
                  columns={[
                    { header: "Regional Partner", render: (row) => {
                      const initials = (row.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
                      return <div style={{display:'flex',alignItems:'center',gap:'10px'}}><div className="approval-avatar" style={{background:'var(--amber-light)',color:'var(--amber)'}}>{initials}</div><div style={{fontWeight:'500'}}>{row.name}</div></div>;
                    }},
                    { header: "Region",   accessor: "regionName"   },
                    { header: "District", accessor: "districtName" },
                    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
                    { header: "Status",   render: statusTag }
                  ]}
                  data={regionsAll}
                  emptyMessage="No regional partners in your state yet."
                />
              </div>
            </div>
          </div>
        );

      // ── Industries sub-page ──
      case '/state/industries':
        return (
          <div className="full-col">
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="section-title">Industry State Partners — {stateName}</div>
                  <div className="section-sub">Each manages a specific industry within your state</div>
                </div>
                <Tag text={`${industryPartners.length} Active`} type="blue" />
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable columns={partnerColumns} data={industriesAll} emptyMessage="No industry state partners created yet." />
              </div>
            </div>
          </div>
        );

      // ── My Earnings (State partner's 10% share) ──
      case '/state/earnings':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="My Total Earnings"   value={formatRupees(stats.myShare)}    delta="State partner share" isUp={true} color="green" />
              <StatCard label="State Revenue Base"  value={formatRupees(stats.stateRevenue)} delta="Total order value"  isUp={true} color="blue" />
              <StatCard label="My Share Rate"        value="10%"                            delta="Of platform fee"     isUp={true} color="amber" />
            </div>
            <div className="card">
              {pageBackHeader('My Earnings Breakdown', `Your 10% share across all revenue categories in ${stateName}`)}
              <div className="card-body" style={{ padding: 0 }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th>Revenue Category</th>
                      <th style={{ textAlign: 'right' }}>Total Collected</th>
                      <th style={{ textAlign: 'right' }}>My Share %</th>
                      <th style={{ textAlign: 'right' }}>My Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REV_CATEGORIES.map((cat, i) => (
                      <tr key={i}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span>{cat.emoji}</span> {cat.name}</div></td>
                        <td className="mono" style={{ textAlign: 'right' }}>—</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--blue)' }}>10%</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '24px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total State Revenue: <span className="mono" style={{ fontWeight: 600, color: 'var(--blue)' }}>{formatRupees(stats.stateRevenue)}</span></span>
                <span style={{ color: 'var(--text-muted)' }}>My Earnings: <span className="mono" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--accent)' }}>{formatRupees(stats.myShare)}</span></span>
              </div>
            </div>
          </div>
        );

      // ── Registered Shops ──
      case '/state/shops':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Registered Shops"   value={String(stats.registeredShops || 0)} delta="Active in your state" isUp={true} color="green" />
              <StatCard label="Districts Covered"  value={String(new Set(shopPartners.map(s => s.districtName).filter(Boolean)).size)} delta="With shops" isUp={true} color="teal" />
              <StatCard label="Industries Covered" value={String(new Set(shopPartners.map(s => s.industry?.name).filter(Boolean)).size)} delta="Distinct sectors" isUp={true} color="purple" />
            </div>
            <div className="card">
              {pageBackHeader('Registered Shops', `All retail shops across ${stateName}`, <Tag text={`${shopPartners.length} Active`} type="green" />)}
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable
                  columns={[
                    { header: "Shop / Owner", render: (row) => avatarCell(row, 'var(--accent-light)', 'var(--accent)') },
                    { header: "Region",   accessor: "regionName"   },
                    { header: "District", accessor: "districtName" },
                    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
                    { header: "Joined",   render: (row) => <span className="mono">{fmtDate(row.createdAt)}</span> },
                    { header: "Status",   render: statusTag }
                  ]}
                  data={shopPartners}
                  emptyMessage="No registered shops in your state yet."
                />
              </div>
            </div>
          </div>
        );

      // ── Delivery Partners ──
      case '/state/delivery':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Delivery Partners"  value={String(stats.deliveryRiders || 0)} delta="Active riders" isUp={true} color="blue" />
              <StatCard label="Districts Covered"  value={String(new Set(executives.map(e => e.districtName).filter(Boolean)).size)} delta="With riders" isUp={true} color="teal" />
              <StatCard label="Regions Covered"    value={String(new Set(executives.map(e => e.regionName).filter(Boolean)).size)} delta="Serviced areas" isUp={true} color="amber" />
            </div>
            <div className="card">
              {pageBackHeader('Delivery Partners', `All delivery & field executives across ${stateName}`, <Tag text={`${executives.length} Active`} type="blue" />)}
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable
                  columns={[
                    { header: "Delivery Partner", render: (row) => avatarCell(row, 'var(--brand-light)', 'var(--brand)') },
                    { header: "Region",   accessor: "regionName"   },
                    { header: "District", accessor: "districtName" },
                    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
                    { header: "Joined",   render: (row) => <span className="mono">{fmtDate(row.createdAt)}</span> },
                    { header: "Status",   render: statusTag }
                  ]}
                  data={executives}
                  emptyMessage="No delivery partners in your state yet."
                />
              </div>
            </div>
          </div>
        );

      // ── Overview (default) ──
      default:
        return (
          <>
            {/* Stats Row 1 */}
            <div className="stat-grid">
              <StatCard label={`${stateName} Total Revenue`} value={formatRupees(stats.stateRevenue)} delta="+21% vs last month" isUp={true} color="blue"  onClick={() => navigate('/state/revenue')}    title="View revenue summary" />
              <StatCard label="My Share (10%)"               value={formatRupees(stats.myShare)}      delta="Earned this month" isUp={true}  color="green" onClick={() => navigate('/state/earnings')}   title="View my earnings" />
              <StatCard label="Industry Partners"             value={String(stats.activeIndustryPartners || 0)} delta="Active industries" isUp={true} color="amber" onClick={() => navigate('/state/industries')} title="View industry partners" />
              <StatCard label="Pending Approvals"             value={String(approvals.length)}        delta="Requires action"   isUp={false} color="red"   onClick={() => navigate('/state/approvals')}  title="Review approvals" />
            </div>

            {/* Stats Row 2 */}
            <div className="stat-grid">
              <StatCard label="District Partners"  value={String(stats.districtPartners  || 0)} delta="+2 this month"  isUp={true} color="purple" onClick={() => navigate('/state/districts')} title="View district partners" />
              <StatCard label="Regional Partners"  value={String(stats.regionalPartners  || 0)} delta="+8 this month"  isUp={true} color="teal"   onClick={() => navigate('/state/regions')}   title="View regional partners" />
              <StatCard label="Registered Shops"   value={String(stats.registeredShops   || 0)} delta="+41 this month" isUp={true} color="blue"   onClick={() => navigate('/state/shops')}     title="View registered shops" />
              <StatCard label="Delivery Partners"  value={String(stats.deliveryRiders    || 0)} delta="+22 this month" isUp={true} color="green"  onClick={() => navigate('/state/delivery')}  title="View delivery partners" />
            </div>

            {/* Revenue by Category */}
            <div className="section-header" style={{ marginBottom: '14px' }}>
              <div>
                <div className="section-title">Revenue by Category</div>
                <div className="section-sub">My state's revenue split across all revenue model types</div>
              </div>
            </div>
            <div className="rev-cat-grid">
              {REV_CATEGORIES.map((cat, i) => (
                <div key={i} className="rev-cat-card">
                  <div className="rev-cat-icon" style={{ background: cat.bg }}>{cat.emoji}</div>
                  <div className="rev-cat-name">{cat.name}</div>
                  <div className="rev-cat-value" style={{ color: cat.color }}>—</div>
                </div>
              ))}
            </div>

            {/* Revenue by Industry / District / Region */}
            <div className="three-col">
              {/* By Industry */}
              <div className="card">
                <div className="card-header">
                  <div className="section-title" style={{ fontSize: '13px' }}>Revenue by Industry</div>
                  <Tag text={`${industryPartners.length} Industries`} type="amber" />
                </div>
                <div className="card-body" style={{ paddingTop: '8px' }}>
                  {industryPartners.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No industry partners yet.</div>
                  ) : (
                    industryPartners.slice(0, 6).map((p, i) => (
                      <div key={p.id} className="region-row" style={i === Math.min(industryPartners.length, 6) - 1 ? { borderBottom: 'none' } : {}}>
                        <div className="region-rank">{i + 1}</div>
                        <div className="region-name">{p.industry?.name || p.name}</div>
                        <div className="region-rev" style={{ color: 'var(--text-muted)' }}>—</div>
                      </div>
                    ))
                  )}
                  {industryPartners.length > 0 && (
                    <div style={{ marginTop: '12px', textAlign: 'center' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('/state/industries')}>All Industries</button>
                    </div>
                  )}
                </div>
              </div>

              {/* By District */}
              <div className="card">
                <div className="card-header">
                  <div className="section-title" style={{ fontSize: '13px' }}>Revenue by District</div>
                  <Tag text={`${districtPartners.length} Districts`} type="purple" />
                </div>
                <div className="card-body" style={{ paddingTop: '8px' }}>
                  {districtPartners.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No district partners yet.</div>
                  ) : (
                    districtPartners.slice(0, 6).map((p, i) => (
                      <div key={p.id} className="region-row" style={i === Math.min(districtPartners.length, 6) - 1 ? { borderBottom: 'none' } : {}}>
                        <div className="region-rank">{i + 1}</div>
                        <div className="region-name">{p.districtName || p.name}</div>
                        <div className="region-rev" style={{ color: 'var(--text-muted)' }}>—</div>
                      </div>
                    ))
                  )}
                  {districtPartners.length > 0 && (
                    <div style={{ marginTop: '12px', textAlign: 'center' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('/state/districts')}>All Districts</button>
                    </div>
                  )}
                </div>
              </div>

              {/* By Region */}
              <div className="card">
                <div className="card-header">
                  <div className="section-title" style={{ fontSize: '13px' }}>Revenue by Region</div>
                  <Tag text={`${regionalPartners.length} Regions`} type="teal" />
                </div>
                <div className="card-body" style={{ paddingTop: '8px' }}>
                  {regionalPartners.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No regional partners yet.</div>
                  ) : (
                    regionalPartners.slice(0, 6).map((p, i) => (
                      <div key={p.id} className="region-row" style={i === Math.min(regionalPartners.length, 6) - 1 ? { borderBottom: 'none' } : {}}>
                        <div className="region-rank">{i + 1}</div>
                        <div className="region-name">{p.regionName || p.name}</div>
                        <div className="region-rev" style={{ color: 'var(--text-muted)' }}>—</div>
                      </div>
                    ))
                  )}
                  {regionalPartners.length > 0 && (
                    <div style={{ marginTop: '12px', textAlign: 'center' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('/state/regions')}>All Regions</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Pending Approvals split cards */}
            <div className="section-header" style={{ marginBottom: '14px' }}>
              <div>
                <div className="section-title">Pending Approvals</div>
                <div className="section-sub">Regional & District Partner profiles awaiting your approval</div>
              </div>
              <span className="pending-count">⚠ {approvals.length} Pending</span>
            </div>
            <div className="two-col">
              {/* Regional */}
              <div className="card">
                <div className="card-header">
                  <div className="section-title" style={{ fontSize: '13px' }}>Regional Partner Profiles</div>
                  <Tag text={`${regionalApprovals.length} Pending`} type="red" />
                </div>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  <div className="info-box" style={{ marginBottom: '12px', fontSize: '12px' }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="8" cy="8" r="6" stroke="#2563EB" strokeWidth="1.4"/><path d="M8 7v4" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    <span>You approve regional partner profiles for your state. Final master approval happens after yours.</span>
                  </div>
                  {regionalApprovals.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No regional partner approvals pending.</div>
                  ) : (
                    regionalApprovals.map(row => {
                      const loc = [row.regionName, row.districtName].filter(Boolean).join(' · ');
                      const initials = (row.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
                      return (
                        <div key={row.id} className="approval-item">
                          <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>{initials}</div>
                          <div className="approval-info">
                            <div className="approval-name">{row.name}</div>
                            <div className="approval-meta">{loc || '—'} {row.industry ? `· ${row.industry.name}` : ''}</div>
                          </div>
                          <div className="approval-actions">
                            <button className="btn-approve" onClick={() => handleApprove(row.id)}>Approve</button>
                            <button className="btn-reject"  onClick={() => handleReject(row.id)}>Reject</button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* District */}
              <div className="card">
                <div className="card-header">
                  <div className="section-title" style={{ fontSize: '13px' }}>District Partner Profiles</div>
                  <Tag text={`${districtApprovalsL.length} Pending`} type="amber" />
                </div>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  <div className="info-box" style={{ marginBottom: '12px', fontSize: '12px' }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="8" cy="8" r="6" stroke="#2563EB" strokeWidth="1.4"/><path d="M8 7v4" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    <span>District partners are created by Industry State Partners. You approve district profiles for your state.</span>
                  </div>
                  {districtApprovalsL.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No district partner approvals pending.</div>
                  ) : (
                    districtApprovalsL.map(row => {
                      const initials = (row.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
                      return (
                        <div key={row.id} className="approval-item">
                          <div className="approval-avatar" style={{ background: 'var(--teal-light)', color: 'var(--teal)' }}>{initials}</div>
                          <div className="approval-info">
                            <div className="approval-name">{row.name}</div>
                            <div className="approval-meta">{row.districtName || '—'} {row.industry ? `· ${row.industry.name}` : ''}</div>
                          </div>
                          <div className="approval-actions">
                            <button className="btn-approve" onClick={() => handleApprove(row.id)}>Approve</button>
                            <button className="btn-reject"  onClick={() => handleReject(row.id)}>Reject</button>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>💡 District partners are created by Industry State Partners inside their profile. You only approve them here.</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Industry State Partners table */}
            <div className="section-header" style={{ marginBottom: '14px' }}>
              <div>
                <div className="section-title">Industry State Partners in {stateName}</div>
                <div className="section-sub">Created by you — each manages a specific industry within your state</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setIsPartnerModalOpen(true)}>
                <Plus size={11} /> Create Industry Partner
              </button>
            </div>
            <div className="card full-col">
              <div className="card-body" style={{ padding: 0 }}>
                <DataTable columns={partnerColumns} data={industryPartners} emptyMessage="No industry state partners created yet." />
              </div>
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Each Industry State Partner manages their industry's district & regional partner creation</span>
                <Tag text={`${industryPartners.length} Active`} type="blue" />
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <DashboardLayout
      role="STATE"
      badges={badges}
      onLogout={onLogout}
      title="State Partner Dashboard"
      subtitle={getSubtitle()}
      locationChain={[{ type: 'state', label: `${stateName} State` }]}
      actionButton={getActionButton()}
    >
      <div className="content">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading dashboard data…</div>
        ) : (
          renderContent()
        )}
      </div>

      {/* ── CREATE INDUSTRY STATE PARTNER MODAL ── */}
      <Modal
        isOpen={isPartnerModalOpen}
        onClose={() => setIsPartnerModalOpen(false)}
        title="Create Industry State Partner Profile"
        subtitle={`Assign an industry-specific partner within your state — ${stateName}`}
        width="680px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setIsPartnerModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handlePartnerSubmit} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Partner'}
            </button>
          </>
        }
      >
        <form onSubmit={handlePartnerSubmit}>
          {/* Location & Industry */}
          <h3 className="form-section-title">Location & Industry Assignment</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Country</label>
              <select className="form-select"><option>India</option></select>
            </div>
            <div className="form-group">
              <label className="form-label">State</label>
              <input className="form-input" type="text" value={stateName} readOnly style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Industry <span>*</span></label>
            <select className="form-select" value={partnerForm.industry} onChange={e => setPartnerForm({...partnerForm, industry: e.target.value})} required>
              <option value="">Select Industry</option>
              {industries.length > 0
                ? industries.map(ind => <option key={ind.id} value={ind.name}>{ind.name}</option>)
                : ['🚗 Automobile','📱 Electronics','🛒 FMCG','💊 Pharma','🌾 Agriculture','👗 Textiles','🏠 Home & Furniture','🍔 Food & Beverage','🏗️ Construction','⚙️ Industrial & Hardware'].map(s => (
                    <option key={s}>{s}</option>
                  ))
              }
            </select>
            <div className="form-hint">Each industry in your state can have only one Industry State Partner</div>
          </div>

          <div className="form-divider" />

          {/* Personal Details */}
          <h3 className="form-section-title">Personal Details</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Full Name <span>*</span></label>
              <input className="form-input" type="text" placeholder="Full name" required value={partnerForm.fullName} onChange={e => setPartnerForm({...partnerForm, fullName: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Mobile Number <span>*</span></label>
              <input className="form-input" type="tel" placeholder="+91 XXXXX XXXXX" required value={partnerForm.mobile} onChange={e => setPartnerForm({...partnerForm, mobile: e.target.value})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email Address <span>*</span></label>
              <input className="form-input" type="email" placeholder="partner@example.com" required value={partnerForm.email} onChange={e => setPartnerForm({...partnerForm, email: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Date of Birth</label>
              <input className="form-input" type="date" value={partnerForm.dob} onChange={e => setPartnerForm({...partnerForm, dob: e.target.value})} />
            </div>
          </div>

          <div className="form-divider" />

          {/* Business Details */}
          <h3 className="form-section-title">Business Details</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Business Name</label>
              <input className="form-input" type="text" placeholder="Registered business name" value={partnerForm.businessName} onChange={e => setPartnerForm({...partnerForm, businessName: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">GST Number</label>
              <input className="form-input" type="text" placeholder="27XXXXX1234X1ZX" value={partnerForm.gstNumber} onChange={e => setPartnerForm({...partnerForm, gstNumber: e.target.value})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Aadhaar Number <span>*</span></label>
              <input className="form-input" type="text" placeholder="XXXX XXXX XXXX" maxLength={14} required value={partnerForm.aadhaarNumber} onChange={e => setPartnerForm({...partnerForm, aadhaarNumber: e.target.value})} />
              <div style={{ marginTop: '6px' }}>
                <div className="upload-zone" onClick={() => aadhaarRef.current?.click()}>
                  <span>🪪</span><span>{aadhaarName}</span>
                </div>
                <input type="file" ref={aadhaarRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setAadhaarName(e.target.files[0]?.name || 'Upload Aadhaar Card — PDF / JPG')} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">PAN Number <span>*</span></label>
              <input className="form-input" type="text" placeholder="ABCDE1234F" maxLength={10} required value={partnerForm.panNumber} onChange={e => setPartnerForm({...partnerForm, panNumber: e.target.value})} />
              <div style={{ marginTop: '6px' }}>
                <div className="upload-zone" onClick={() => panRef.current?.click()}>
                  <span>🪪</span><span>{panName}</span>
                </div>
                <input type="file" ref={panRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setPanName(e.target.files[0]?.name || 'Upload PAN Card — PDF / JPG')} />
              </div>
            </div>
          </div>

          {/* Maintenance Cost */}
          <div className="form-full" style={{ background: 'var(--amber-light)', border: '1px solid #FCD34D', borderRadius: 'var(--radius-sm)', padding: '14px 16px', marginTop: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3L1 14h14L8 3z" stroke="#92400E" strokeWidth="1.4" strokeLinejoin="round"/><path d="M8 7v3" stroke="#92400E" strokeWidth="1.4" strokeLinecap="round"/></svg>
              <h3 className="form-section-title" style={{ marginBottom: 0, color: '#92400E' }}>Maintenance Cost (Auto-Expense)</h3>
            </div>
            <div className="form-row" style={{ marginBottom: '8px' }}>
              <div className="form-group">
                <label className="form-label">Monthly Maintenance Cost (₹)</label>
                <input className="form-input mono" type="number" placeholder="e.g. 5000" value={partnerForm.maintenanceCost} onChange={e => setPartnerForm({...partnerForm, maintenanceCost: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Annual Total</label>
                <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: "'DM Mono', monospace", fontSize: '14px', fontWeight: '600', color: 'var(--amber)' }}>
                  {partnerForm.maintenanceCost ? `₹${(parseFloat(partnerForm.maintenanceCost) * 12).toLocaleString('en-IN')}` : '₹0'}
                </div>
              </div>
            </div>
          </div>

          <div className="form-divider" />

          {/* Bank Details */}
          <h3 className="form-section-title">Bank Details</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Bank Name <span>*</span></label>
              <select className="form-select" value={partnerForm.bankName} onChange={e => setPartnerForm({...partnerForm, bankName: e.target.value})} required>
                <option value="">Select Bank</option>
                {['State Bank of India','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra Bank','Punjab National Bank','Bank of Baroda','IndusInd Bank','Yes Bank','Federal Bank','Other'].map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Account Holder Name</label>
              <input className="form-input" type="text" placeholder="As per bank records" value={partnerForm.accountHolder} onChange={e => setPartnerForm({...partnerForm, accountHolder: e.target.value})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Account Number <span>*</span></label>
              <input className="form-input" type="text" placeholder="Account number" required value={partnerForm.accountNumber} onChange={e => setPartnerForm({...partnerForm, accountNumber: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">IFSC Code <span>*</span></label>
              <input className="form-input" type="text" placeholder="SBIN0001234" required value={partnerForm.ifscCode} onChange={e => setPartnerForm({...partnerForm, ifscCode: e.target.value})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Account Type</label>
              <select className="form-select" value={partnerForm.accountType} onChange={e => setPartnerForm({...partnerForm, accountType: e.target.value})}>
                <option value="Savings">Savings Account</option>
                <option value="Current">Current Account</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">UPI ID (optional)</label>
              <input className="form-input" type="text" placeholder="name@upi" value={partnerForm.upiId} onChange={e => setPartnerForm({...partnerForm, upiId: e.target.value})} />
            </div>
          </div>

          <div className="form-divider" />

          {/* Documents */}
          <h3 className="form-section-title">Agreement & Documents</h3>
          <div className="form-group">
            <label className="form-label">Partnership Agreement <span>*</span></label>
            <div className="upload-zone upload-zone-lg" onClick={() => agreementRef.current?.click()}>
              <div style={{ fontSize: '22px', marginBottom: '6px' }}>📄</div>
              <div style={{ fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '3px' }}>{agreementName}</div>
              <div style={{ fontSize: '11.5px' }}>Signed partnership agreement — PDF, DOC, DOCX up to 10MB</div>
            </div>
            <input type="file" ref={agreementRef} accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={e => setAgreementName(e.target.files[0]?.name || 'Click to upload or drag & drop')} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Cancelled Cheque / Passbook</label>
              <div className="upload-zone" onClick={() => chequeRef.current?.click()}>
                <span style={{ fontSize: '16px' }}>🏦</span><span>{chequeName}</span>
              </div>
              <input type="file" ref={chequeRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setChequeName(e.target.files[0]?.name || 'Attach cancelled cheque (PDF / JPG)')} />
            </div>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
};

export default StateDashboard;
