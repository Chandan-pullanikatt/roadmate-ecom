import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StatCard from '../components/ui/StatCard';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Tag from '../components/ui/Tag';
import { Plus, Check, X, Download } from 'lucide-react';
import {
  getOverviewStats,
  getPendingApprovals,
  approvePartner,
  rejectPartner,
  createPartner,
  getExpenses,
  createExpense,
  getMasterStatesOverview,
  getMasterDistrictsOverview,
  getActivePartners
} from '../utils/api';

// ── Static revenue model config (platform-level, no DB persistence needed) ──
const REVENUE_MODELS = [
  { name: "Standard Shop Subscription",       category: "Shop Subscription",         charge: "₹999/mo",     RP: "25%", DP: "20%", ISP: "15%", SP: "10%", retained: "30%" },
  { name: "Premium Distributor Portal",        category: "Distributor Subscription",  charge: "₹15,000/mo",  RP: "20%", DP: "18%", ISP: "15%", SP: "10%", retained: "37%" },
  { name: "Standard Delivery Partner Rider",   category: "Delivery Subscription",     charge: "₹499/mo",     RP: "30%", DP: "15%", ISP: "10%", SP: "10%", retained: "35%" },
];

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
  STATE: 'State Partner', IND_STATE: 'Industry State Partner',
  DISTRICT: 'District Partner', REGIONAL: 'Regional Partner',
  MANUFACTURER: 'Manufacturer', DISTRIBUTOR: 'Distributor',
  SHOP: 'Shop Owner', EXECUTIVE: 'Field Executive'
};

const roleTagColor = (role) => {
  if (role === 'REGIONAL')  return 'amber';
  if (role === 'IND_STATE') return 'purple';
  if (role === 'DISTRICT')  return 'teal';
  return 'blue';
};

// ── Component ──
const MasterDashboard = ({ onLogout }) => {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();

  // ── Server-driven state ──
  const [stats, setStats] = useState({
    totalRevenue: 0, statePartners: 0, industryPartners: 0, pendingApprovals: 0,
    districtPartners: 0, regionalPartners: 0, registeredShops: 0, activeDistributors: 0
  });
  const [approvals, setApprovals]       = useState([]);
  const [expenses, setExpenses]         = useState([]);
  const [statesData, setStatesData]     = useState([]);
  const [districtsData, setDistrictsData] = useState([]);
  const [activePartners, setActivePartners] = useState([]);
  const [loading, setLoading]           = useState(true);

  // ── Sidebar badges ──
  const [badges, setBadges] = useState({ pendingApprovals: 0 });

  // ── Modal open flags ──
  const [isStatePartnerOpen,  setIsStatePartnerOpen]  = useState(false);
  const [isExpenseOpen,       setIsExpenseOpen]       = useState(false);
  const [isRevenueModelOpen,  setIsRevenueModelOpen]  = useState(false);

  // ── Revenue model form (local state only — static config) ──
  const [revModelForm, setRevModelForm] = useState({
    name: '', category: 'shop', charge: '', RP: '', DP: '', ISP: '', SP: ''
  });
  const [localRevenueModels, setLocalRevenueModels] = useState(REVENUE_MODELS);

  // ── State partner form ──
  const defaultSPForm = {
    country: 'India', state: '', fullName: '', mobile: '', email: '', dob: '',
    businessName: '', gstNumber: '', aadhaarNumber: '', panNumber: '',
    maintenanceCost: '',
    bankName: '', accountHolder: '', accountNumber: '', ifscCode: '',
    accountType: 'Current', upiId: ''
  };
  const [statePartnerForm, setStatePartnerForm] = useState(defaultSPForm);
  const [spSubmitting, setSpSubmitting] = useState(false);

  // File input refs (visual only — no upload endpoint yet)
  const aadhaarFileRef   = useRef(null);
  const panFileRef       = useRef(null);
  const agreementFileRef = useRef(null);
  const chequeFileRef    = useRef(null);
  const [aadhaarFileName,   setAadhaarFileName]   = useState('Upload Aadhaar Card — PDF / JPG');
  const [panFileName,       setPanFileName]       = useState('Upload PAN Card — PDF / JPG');
  const [agreementFileName, setAgreementFileName] = useState('Click to upload or drag & drop');
  const [chequeFileName,    setChequeFileName]    = useState('Attach cancelled cheque (PDF / JPG)');

  // ── Expense form ──
  const defaultExpForm = {
    description: '', amount: '', date: new Date().toISOString().split('T')[0],
    category: '', state: '', notes: ''
  };
  const [expenseForm, setExpenseForm]   = useState(defaultExpForm);
  const [expSubmitting, setExpSubmitting] = useState(false);
  const expReceiptRef = useRef(null);
  const [expReceiptName, setExpReceiptName] = useState('Attach Receipt');

  // ── Fetch all data ──
  const refreshDashboard = async () => {
    setLoading(true);
    try {
      const [statsRes, approvalsRes, expensesRes, statesRes, districtsRes, partnersRes] = await Promise.all([
        getOverviewStats(),
        getPendingApprovals(),
        getExpenses(),
        getMasterStatesOverview(),
        getMasterDistrictsOverview(),
        getActivePartners()
      ]);
      if (statsRes.status === 'success')     { setStats(statsRes.stats); }
      if (approvalsRes.status === 'success') {
        setApprovals(approvalsRes.approvals);
        setBadges({ pendingApprovals: approvalsRes.approvals.length });
      }
      if (expensesRes.status === 'success')  { setExpenses(expensesRes.expenses); }
      if (statesRes.status === 'success')    { setStatesData(statesRes.states); }
      if (districtsRes.status === 'success') { setDistrictsData(districtsRes.districts); }
      if (partnersRes.status === 'success')  { setActivePartners(partnersRes.partners); }
    } catch (err) {
      console.error('Dashboard refresh error:', err);
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
      setBadges(prev => ({ pendingApprovals: Math.max(0, prev.pendingApprovals - 1) }));
    } catch (err) { console.error('Approve error:', err); }
  };

  const handleReject = async (id) => {
    try {
      await rejectPartner(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
      setBadges(prev => ({ pendingApprovals: Math.max(0, prev.pendingApprovals - 1) }));
    } catch (err) { console.error('Reject error:', err); }
  };

  const handleStatePartnerSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setSpSubmitting(true);
    try {
      await createPartner({
        role: 'STATE',
        name: statePartnerForm.fullName,
        email: statePartnerForm.email,
        phone: statePartnerForm.mobile,
        stateName: statePartnerForm.state,
        businessName: statePartnerForm.businessName,
        gstNumber: statePartnerForm.gstNumber,
        aadhaarNumber: statePartnerForm.aadhaarNumber,
        panNumber: statePartnerForm.panNumber,
        monthlyCost: statePartnerForm.maintenanceCost ? parseFloat(statePartnerForm.maintenanceCost) : 0,
        bankName: statePartnerForm.bankName,
        accountHolder: statePartnerForm.accountHolder,
        accountNumber: statePartnerForm.accountNumber,
        ifscCode: statePartnerForm.ifscCode,
        accountType: statePartnerForm.accountType,
        upiId: statePartnerForm.upiId
      });
      setIsStatePartnerOpen(false);
      setStatePartnerForm(defaultSPForm);
      setAadhaarFileName('Upload Aadhaar Card — PDF / JPG');
      setPanFileName('Upload PAN Card — PDF / JPG');
      setAgreementFileName('Click to upload or drag & drop');
      setChequeFileName('Attach cancelled cheque (PDF / JPG)');
      refreshDashboard();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to create state partner. Please try again.');
      console.error('Create partner error:', err);
    } finally {
      setSpSubmitting(false);
    }
  };

  const handleExpenseSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setExpSubmitting(true);
    try {
      await createExpense({
        title: expenseForm.description,
        amount: parseFloat(expenseForm.amount),
        category: expenseForm.category || 'Other',
        notes: expenseForm.notes || (expenseForm.state ? `State: ${expenseForm.state}` : '')
      });
      setIsExpenseOpen(false);
      setExpenseForm(defaultExpForm);
      setExpReceiptName('Attach Receipt');
      refreshDashboard();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to add expense. Please try again.');
      console.error('Create expense error:', err);
    } finally {
      setExpSubmitting(false);
    }
  };

  const handleRevModelSave = () => {
    if (!revModelForm.name || !revModelForm.charge) return;
    const retained = Math.max(0, 100 - [revModelForm.RP, revModelForm.DP, revModelForm.ISP, revModelForm.SP]
      .map(v => parseFloat(v) || 0).reduce((a, b) => a + b, 0));
    setLocalRevenueModels(prev => [...prev, {
      name: revModelForm.name,
      category: revModelForm.category,
      charge: revModelForm.charge,
      RP: revModelForm.RP ? `${revModelForm.RP}%` : '—',
      DP: revModelForm.DP ? `${revModelForm.DP}%` : '—',
      ISP: revModelForm.ISP ? `${revModelForm.ISP}%` : '—',
      SP: revModelForm.SP ? `${revModelForm.SP}%` : '—',
      retained: `${retained}%`
    }]);
    setIsRevenueModelOpen(false);
    setRevModelForm({ name: '', category: 'shop', charge: '', RP: '', DP: '', ISP: '', SP: '' });
  };

  // ── Computed values for sub-page stat cards ──
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthExp   = expenses.filter(e => e.createdAt?.startsWith(thisMonth));
  const totalMonthExp  = monthExp.reduce((s, e) => s + (e.amount || 0), 0);
  const techExp        = monthExp.filter(e => e.category === 'Technology').reduce((s, e) => s + (e.amount || 0), 0);
  const mktExp         = monthExp.filter(e => e.category === 'Marketing').reduce((s, e) => s + (e.amount || 0), 0);
  const hrExp          = monthExp.filter(e => e.category === 'HR & Payroll').reduce((s, e) => s + (e.amount || 0), 0);

  const totalActiveStates    = statesData.filter(s => s.status === 'Active').length;
  const totalUnassigned      = statesData.filter(s => s.status !== 'Active').length;
  const totalDistrictsCovered= statesData.reduce((s, x) => s + (x.districts || 0), 0);
  const totalRegionsCovered  = statesData.reduce((s, x) => s + (x.regions || 0), 0);

  const totalDistrictPartners  = districtsData.length;
  const totalRegionalPartners  = districtsData.reduce((s, d) => s + (d.regions || 0), 0);
  const avgRegions = totalDistrictPartners > 0
    ? (totalRegionalPartners / totalDistrictPartners).toFixed(1) : '0';

  // ── Partner lists, split by role (for the per-card standalone pages) ──
  // Overview stat counts include every record regardless of approval status, so the
  // detail pages combine approved (active) partners with the pending approvals queue
  // to match those counts. The status column distinguishes Active vs Pending.
  const allPartners       = [...activePartners, ...approvals];
  const indStatePartners  = allPartners.filter(p => p.role === 'IND_STATE');
  const districtPartners  = allPartners.filter(p => p.role === 'DISTRICT');
  const regionalPartners  = allPartners.filter(p => p.role === 'REGIONAL');
  const shopPartners      = allPartners.filter(p => p.role === 'SHOP');
  const distributorList   = allPartners.filter(p => p.role === 'DISTRIBUTOR');

  // ── Revenue-by-state breakdown (actual ₹ flows from states overview) ──
  const revenueByState = [...statesData].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const totalStateRevenue = revenueByState.reduce((s, x) => s + (x.revenue || 0), 0);
  const avgStateRevenue = revenueByState.length
    ? totalStateRevenue / revenueByState.length : 0;

  const uniqueIndustries = [...new Set(indStatePartners.map(p => p.industry?.name).filter(Boolean))];

  // Count helpers for partner pages (regions/shops per district from districtsData)
  const regionsForDistrict = (name) => districtsData.find(d => d.district === name)?.regions ?? '—';
  const shopsForDistrict   = (name) => districtsData.find(d => d.district === name)?.shops ?? '—';

  // ── Column definitions ──
  const approvalColumns = [
    {
      header: "Partner Profile Details",
      render: (row) => {
        const loc = [row.regionName, row.districtName, row.stateName].filter(Boolean).join(', ');
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
      header: "Partner Tier",
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

  const expenseColumns = [
    { header: "Expense Details", render: (row) => <span>{row.title || '—'}</span> },
    { header: "Category", render: (row) => <Tag text={row.category || 'Other'} type="purple" /> },
    { header: "Notes / Region", render: (row) => <span>{row.notes || '—'}</span> },
    { header: "Transaction Date", render: (row) => <span className="mono">{fmtDate(row.createdAt)}</span> },
    {
      header: "Amount",
      cellStyle: { fontWeight: '600', fontFamily: 'DM Mono, monospace' },
      render: (row) => `₹${Number(row.amount || 0).toLocaleString('en-IN')}`
    }
  ];

  const revModelColumns = [
    { header: "Revenue Model Name", accessor: "name" },
    { header: "Charge Setup",      cellStyle: { fontWeight: '500' }, accessor: "charge" },
    { header: "Regional %",        cellStyle: { color: 'var(--amber)',  fontWeight: '600' }, accessor: "RP" },
    { header: "District %",        cellStyle: { color: 'var(--teal)',   fontWeight: '600' }, accessor: "DP" },
    { header: "Ind. State %",      cellStyle: { color: 'var(--purple)', fontWeight: '600' }, accessor: "ISP" },
    { header: "State Partner %",   cellStyle: { color: 'var(--blue)',   fontWeight: '600' }, accessor: "SP" },
    { header: "Retained (Master)", cellStyle: { color: 'var(--green)',  fontWeight: '600' }, accessor: "retained" }
  ];

  const statesColumns = [
    { header: "State",          accessor: "state" },
    { header: "State Partner",  accessor: "partner" },
    { header: "Districts",      cellStyle: { fontFamily: 'DM Mono, monospace' }, accessor: "districts" },
    { header: "Regions",        cellStyle: { fontFamily: 'DM Mono, monospace' }, accessor: "regions" },
    { header: "Shops",          cellStyle: { fontFamily: 'DM Mono, monospace' }, accessor: "shops" },
    {
      header: "Revenue",
      cellStyle: { fontWeight: '600', fontFamily: 'DM Mono, monospace' },
      render: (row) => formatRupees(row.revenue)
    },
    {
      header: "Status",
      render: (row) => <Tag text={row.status} type={row.status === 'Active' ? 'green' : 'amber'} />
    }
  ];

  const districtsColumns = [
    { header: "District",          accessor: "district" },
    { header: "State",             accessor: "state" },
    { header: "District Partner",  accessor: "partner" },
    { header: "Regions",           cellStyle: { fontFamily: 'DM Mono, monospace' }, accessor: "regions" },
    { header: "Shops",             cellStyle: { fontFamily: 'DM Mono, monospace' }, accessor: "shops" },
    {
      header: "Revenue",
      cellStyle: { fontWeight: '600', fontFamily: 'DM Mono, monospace' },
      render: (row) => formatRupees(row.revenue)
    }
  ];

  // ── Shared cell helpers for the per-card partner pages ──
  const initialsOf = (name) =>
    (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const partnerNameCell = (row) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
        {initialsOf(row.name)}
      </div>
      <div>
        <div className="approval-name">{row.name || '—'}</div>
        <div className="approval-meta">{row.email || row.phone || '—'}</div>
      </div>
    </div>
  );

  const statusTag = (row) => (
    <Tag text={row.isActive ? 'Active' : 'Pending'} type={row.isActive ? 'green' : 'amber'} />
  );

  const revenueByStateColumns = [
    { header: "State",        accessor: "state" },
    { header: "State Partner", accessor: "partner" },
    { header: "Shops", cellStyle: { fontFamily: 'DM Mono, monospace' }, accessor: "shops" },
    {
      header: "Revenue",
      cellStyle: { fontWeight: '600', fontFamily: 'DM Mono, monospace' },
      render: (row) => formatRupees(row.revenue)
    },
    {
      header: "Share of Total",
      cellStyle: { fontFamily: 'DM Mono, monospace', color: 'var(--brand)' },
      render: (row) => totalStateRevenue > 0
        ? `${(((row.revenue || 0) / totalStateRevenue) * 100).toFixed(1)}%` : '—'
    }
  ];

  const indStateColumns = [
    { header: "Industry State Partner", render: partnerNameCell },
    { header: "State", accessor: "stateName" },
    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
    { header: "Joined", render: (row) => <span className="mono">{fmtDate(row.createdAt)}</span> },
    { header: "Status", cellStyle: { textAlign: 'right' }, render: statusTag }
  ];

  const districtPartnerColumns = [
    { header: "District Partner", render: partnerNameCell },
    { header: "District", accessor: "districtName" },
    { header: "State", accessor: "stateName" },
    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
    { header: "Regions", cellStyle: { fontFamily: 'DM Mono, monospace' }, render: (row) => regionsForDistrict(row.districtName) },
    { header: "Shops",   cellStyle: { fontFamily: 'DM Mono, monospace' }, render: (row) => shopsForDistrict(row.districtName) },
    { header: "Status", cellStyle: { textAlign: 'right' }, render: statusTag }
  ];

  const regionalPartnerColumns = [
    { header: "Regional Partner", render: partnerNameCell },
    { header: "Region", render: (row) => <Tag text={row.regionName || '—'} type="teal" /> },
    { header: "District", accessor: "districtName" },
    { header: "State", accessor: "stateName" },
    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
    { header: "Status", cellStyle: { textAlign: 'right' }, render: statusTag }
  ];

  const shopColumns = [
    { header: "Shop / Owner", render: partnerNameCell },
    { header: "Region", render: (row) => <Tag text={row.regionName || '—'} type="teal" /> },
    { header: "District", accessor: "districtName" },
    { header: "State", accessor: "stateName" },
    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
    { header: "Joined", render: (row) => <span className="mono">{fmtDate(row.createdAt)}</span> },
    { header: "Status", cellStyle: { textAlign: 'right' }, render: statusTag }
  ];

  const distributorColumns = [
    { header: "Distributor", render: (row) => (
      <div>
        <div className="approval-name">{row.businessName || row.name || '—'}</div>
        <div className="approval-meta">{row.name || row.email || '—'}</div>
      </div>
    ) },
    { header: "District", accessor: "districtName" },
    { header: "State", accessor: "stateName" },
    { header: "Industry", render: (row) => <Tag text={row.industry?.name || '—'} type="purple" /> },
    {
      header: "Subscription",
      cellStyle: { fontFamily: 'DM Mono, monospace', color: 'var(--green)' },
      render: (row) => row.monthlyCost ? `₹${Number(row.monthlyCost).toLocaleString('en-IN')}/mo` : '—'
    },
    { header: "Status", cellStyle: { textAlign: 'right' }, render: statusTag }
  ];

  // ── Page header with a back-to-dashboard link (for routes not in the sidebar) ──
  const pageHeader = (title, sub) => (
    <div className="card-header">
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="section-sub">
          <a style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={() => navigate('/master')}>‹ Dashboard</a>
          {sub ? <> · {sub}</> : null}
        </p>
      </div>
    </div>
  );

  // ── Header action buttons per route ──
  const getActionButton = () => {
    switch (pathname) {
      case '/master':
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={() => setIsExpenseOpen(true)}>
              <Plus size={14} /> Add Expense
            </button>
            <button className="btn btn-outline" onClick={() => setIsRevenueModelOpen(true)}>
              <Plus size={14} /> New Model
            </button>
            <button className="btn btn-primary" onClick={() => setIsStatePartnerOpen(true)}>
              <Plus size={14} /> Create State Partner
            </button>
          </div>
        );
      case '/master/revenue-models':
        return (
          <button className="btn btn-primary" onClick={() => setIsRevenueModelOpen(true)}>
            <Plus size={14} /> Add New Model
          </button>
        );
      case '/master/approvals':
        return <Tag text={`${approvals.length} Pending`} type="red" />;
      case '/master/expenses':
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline"><Download size={14} /> Export CSV</button>
            <button className="btn btn-primary" onClick={() => setIsExpenseOpen(true)}>
              <Plus size={14} /> Add Expense
            </button>
          </div>
        );
      case '/master/states':
        return (
          <button className="btn btn-primary" onClick={() => setIsStatePartnerOpen(true)}>
            <Plus size={14} /> Create State Partner
          </button>
        );
      default: return null;
    }
  };

  const getSubtitle = () => {
    switch (pathname) {
      case '/master':                return 'National Overview & Ecosystem Governance';
      case '/master/revenue-models': return 'Manage platform revenue split configurations';
      case '/master/partners':       return 'Onboard a new State Partner to the platform';
      case '/master/approvals':      return 'Review and action pending partner applications';
      case '/master/expenses':       return 'Track and manage platform operating expenses';
      case '/master/states':         return 'Overview of all state-level partner assignments';
      case '/master/districts-regions': return 'Geographic breakdown of districts and regions';
      case '/master/revenue':        return 'Platform revenue breakdown by state';
      case '/master/industries':     return 'All industry state partners across sectors';
      case '/master/district-partners': return 'All district-level partners and their territory';
      case '/master/regional-partners': return 'All regional partners mapped under districts';
      case '/master/shops':          return 'All registered retail shops on the platform';
      case '/master/distributors':   return 'All active distributors and subscriptions';
      default: return 'National Overview & Ecosystem Governance';
    }
  };

  // ── Page content renderer ──
  const renderContent = () => {
    switch (pathname) {

      // ── Revenue Models ──
      case '/master/revenue-models':
        return (
          <div className="full-col">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Active Revenue Models & Commission Splits</h2>
                  <p className="section-sub">Configure how platform revenue is distributed across partner tiers</p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setIsRevenueModelOpen(true)}>
                  <Plus size={12} /> Add New Model
                </button>
              </div>
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={revModelColumns} data={localRevenueModels} emptyMessage="No revenue models configured yet." />
              </div>
            </div>
          </div>
        );

      // ── Create State Partner (form page) ──
      case '/master/partners':
        return (
          <div className="form-page">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Create State Partner Profile</h2>
                  <p className="section-sub">Onboard a new state-level partner with full KYC and bank details</p>
                </div>
              </div>
              <div className="card-body">
                {renderStatePartnerForm(statePartnerForm, setStatePartnerForm, handleStatePartnerSubmit, () => setStatePartnerForm(defaultSPForm), spSubmitting)}
              </div>
            </div>
          </div>
        );

      // ── Pending Approvals ──
      case '/master/approvals':
        return (
          <div className="full-col">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Pending Partner Profile Approvals</h2>
                  <p className="section-sub">Review, approve, or reject incoming partner applications</p>
                </div>
                <Tag text={`${approvals.length} Pending`} type="red" />
              </div>
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={approvalColumns} data={approvals} emptyMessage="No pending profiles require approval. All caught up!" />
              </div>
            </div>
          </div>
        );

      // ── Expenses full-page ──
      case '/master/expenses':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Total Expenses (This Month)" value={formatRupees(totalMonthExp)} delta={`${monthExp.length} transaction${monthExp.length !== 1 ? 's' : ''}`} isUp={false} color="red" />
              <StatCard label="Technology & Hosting"        value={formatRupees(techExp)} delta={`${monthExp.filter(e=>e.category==='Technology').length} transaction${monthExp.filter(e=>e.category==='Technology').length !== 1 ? 's' : ''}`} isUp={false} color="purple" />
              <StatCard label="Marketing & Campaigns"       value={formatRupees(mktExp)}  delta={`${monthExp.filter(e=>e.category==='Marketing').length} transaction${monthExp.filter(e=>e.category==='Marketing').length !== 1 ? 's' : ''}`}  isUp={false} color="blue" />
              <StatCard label="HR & Payroll"                value={formatRupees(hrExp)}   delta={`${monthExp.filter(e=>e.category==='HR & Payroll').length} transaction${monthExp.filter(e=>e.category==='HR & Payroll').length !== 1 ? 's' : ''}`}   isUp={false} color="amber" />
            </div>
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Platform Operating Expenses</h2>
                  <p className="section-sub">Expenditure distribution across regional and central categories</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-outline btn-sm"><Download size={12} /> Export CSV</button>
                  <button className="btn btn-outline btn-sm">Filter by State</button>
                </div>
              </div>
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={expenseColumns} data={expenses} emptyMessage="No expenses recorded yet." />
              </div>
            </div>
          </div>
        );

      // ── States Overview ──
      case '/master/states':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Total Active States"     value={String(totalActiveStates)}   delta="Out of 28 states + 8 UTs"          isUp={true}  color="green" />
              <StatCard label="Unassigned States"       value={String(totalUnassigned)}     delta="Needs partner assignment"           isUp={false} color="amber" />
              <StatCard label="Total Districts Covered" value={String(totalDistrictsCovered)} delta="Across all active states"         isUp={true}  color="teal" />
              <StatCard label="Total Regions"           value={String(totalRegionsCovered)} delta="Across all districts"               isUp={true}  color="blue" />
            </div>
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">All States & Partner Assignments</h2>
                  <p className="section-sub">Overview of state-level partner assignments and performance metrics</p>
                </div>
              </div>
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={statesColumns} data={statesData} emptyMessage="No state partners onboarded yet." />
              </div>
            </div>
          </div>
        );

      // ── Districts & Regions ──
      case '/master/districts-regions':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Total District Partners"  value={String(totalDistrictPartners)} delta={`+${totalDistrictPartners} active`} isUp={true}  color="teal" />
              <StatCard label="Total Regional Partners"  value={String(totalRegionalPartners)} delta="Mapped under districts"           isUp={true}  color="amber" />
              <StatCard label="Avg Regions per District" value={avgRegions}                    delta="National average"                 isUp={true}  color="blue" />
              <StatCard label="Unassigned Districts"     value="0"                             delta="All districts assigned"          isUp={true}  color="green" />
            </div>
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Districts & Region Breakdown</h2>
                  <p className="section-sub">Geographic breakdown of all districts with assigned partners and revenue</p>
                </div>
              </div>
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={districtsColumns} data={districtsData} emptyMessage="No district partners onboarded yet." />
              </div>
            </div>
          </div>
        );

      // ── Platform Revenue breakdown ──
      case '/master/revenue':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Total Platform Revenue" value={formatRupees(stats.totalRevenue)}  delta="All-time B2B order value" isUp={true} color="green" />
              <StatCard label="Revenue (Tracked States)" value={formatRupees(totalStateRevenue)} delta={`${revenueByState.length} states`} isUp={true} color="blue" />
              <StatCard label="Avg Revenue / State"     value={formatRupees(avgStateRevenue)}    delta="Across active states"   isUp={true} color="teal" />
              <StatCard label="Top State"               value={revenueByState[0]?.state || '—'}  delta={revenueByState[0] ? formatRupees(revenueByState[0].revenue) : '—'} isUp={true} color="purple" />
            </div>
            <div className="card">
              {pageHeader('Platform Revenue by State', 'Actual order revenue flowing through each state, highest first')}
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={revenueByStateColumns} data={revenueByState} emptyMessage="No revenue recorded yet." />
              </div>
            </div>
          </div>
        );

      // ── Industry (IND_STATE) partners ──
      case '/master/industries':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Industry State Partners" value={String(indStatePartners.length)}   delta="Active across platform" isUp={true} color="purple" />
              <StatCard label="Industries Covered"      value={String(uniqueIndustries.length)}   delta="Distinct sectors"       isUp={true} color="blue" />
              <StatCard label="States Represented"      value={String(new Set(indStatePartners.map(p => p.stateName).filter(Boolean)).size)} delta="With an industry partner" isUp={true} color="teal" />
            </div>
            <div className="card">
              {pageHeader('Industry State Partners', 'All active industry-level partners and the sectors they manage')}
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={indStateColumns} data={indStatePartners} emptyMessage="No industry state partners onboarded yet." />
              </div>
            </div>
          </div>
        );

      // ── District partners (people) ──
      case '/master/district-partners':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="District Partners"   value={String(districtPartners.length)} delta="Active across platform" isUp={true} color="teal" />
              <StatCard label="States Covered"      value={String(new Set(districtPartners.map(p => p.stateName).filter(Boolean)).size)} delta="With a district partner" isUp={true} color="blue" />
              <StatCard label="Industries Covered"  value={String(new Set(districtPartners.map(p => p.industry?.name).filter(Boolean)).size)} delta="Distinct sectors" isUp={true} color="purple" />
            </div>
            <div className="card">
              {pageHeader('District Partners', 'All active district-level partners with their territory and coverage')}
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={districtPartnerColumns} data={districtPartners} emptyMessage="No district partners onboarded yet." />
              </div>
            </div>
          </div>
        );

      // ── Regional partners (people) ──
      case '/master/regional-partners':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Regional Partners"   value={String(regionalPartners.length)} delta="Active across platform" isUp={true} color="amber" />
              <StatCard label="Districts Covered"   value={String(new Set(regionalPartners.map(p => p.districtName).filter(Boolean)).size)} delta="With a regional partner" isUp={true} color="teal" />
              <StatCard label="Industries Covered"  value={String(new Set(regionalPartners.map(p => p.industry?.name).filter(Boolean)).size)} delta="Distinct sectors" isUp={true} color="purple" />
            </div>
            <div className="card">
              {pageHeader('Regional Partners', 'All active regional partners mapped under their districts')}
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={regionalPartnerColumns} data={regionalPartners} emptyMessage="No regional partners onboarded yet." />
              </div>
            </div>
          </div>
        );

      // ── Registered shops ──
      case '/master/shops':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Registered Shops"   value={String(shopPartners.length)} delta="Active across platform" isUp={true} color="green" />
              <StatCard label="States Covered"     value={String(new Set(shopPartners.map(p => p.stateName).filter(Boolean)).size)}  delta="With registered shops" isUp={true} color="blue" />
              <StatCard label="Industries Covered" value={String(new Set(shopPartners.map(p => p.industry?.name).filter(Boolean)).size)} delta="Distinct sectors" isUp={true} color="purple" />
            </div>
            <div className="card">
              {pageHeader('Registered Shops', 'All active retail shops across every region and industry')}
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={shopColumns} data={shopPartners} emptyMessage="No shops registered yet." />
              </div>
            </div>
          </div>
        );

      // ── Active distributors ──
      case '/master/distributors':
        return (
          <div className="full-col">
            <div className="stat-grid" style={{ marginBottom: '20px' }}>
              <StatCard label="Total Distributors"   value={String(distributorList.length)} delta={`${distributorList.filter(d => d.isActive).length} active`} isUp={true} color="blue" />
              <StatCard label="Subscription Revenue" value={formatRupees(distributorList.filter(d => d.isActive).reduce((s, d) => s + (d.monthlyCost || 0), 0))} delta="Monthly recurring (active)" isUp={true} color="green" />
              <StatCard label="Industries Covered"   value={String(new Set(distributorList.map(p => p.industry?.name).filter(Boolean)).size)} delta="Distinct sectors" isUp={true} color="purple" />
            </div>
            <div className="card">
              {pageHeader('Active Distributors', 'All active distributors and their platform subscriptions')}
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable columns={distributorColumns} data={distributorList} emptyMessage="No distributors onboarded yet." />
              </div>
            </div>
          </div>
        );

      // ── Overview (default) ──
      default:
        return (
          <>
            <div className="stat-grid">
              <StatCard label="Total Platform Revenue" value={formatRupees(stats.totalRevenue)}     delta="+18.4% vs last month"  isUp={true}  color="green"  onClick={() => navigate('/master/revenue')}           title="View revenue breakdown" />
              <StatCard label="Active State Partners"  value={String(stats.statePartners || 0)}    delta="+3 new this month"      isUp={true}  color="blue"   onClick={() => navigate('/master/states')}            title="View state partners" />
              <StatCard label="Industry Partners"      value={String(stats.industryPartners || 0)} delta="Active sectors"          isUp={true}  color="purple" onClick={() => navigate('/master/industries')}        title="View industry partners" />
              <StatCard label="Pending Approvals"      value={String(stats.pendingApprovals || 0)} delta="Requires action"         isUp={false} color="red"    onClick={() => navigate('/master/approvals')}         title="Review pending approvals" />
            </div>
            <div className="stat-grid">
              <StatCard label="District Partners"  value={String(stats.districtPartners || 0)}  delta="+24 this quarter" isUp={true} color="teal"  onClick={() => navigate('/master/district-partners')} title="View district partners" />
              <StatCard label="Regional Partners"  value={String(stats.regionalPartners || 0)}  delta="+96 this month"   isUp={true} color="amber" onClick={() => navigate('/master/regional-partners')} title="View regional partners" />
              <StatCard label="Registered Shops"   value={String(stats.registeredShops || 0)}   delta="+340 this month"  isUp={true} color="green" onClick={() => navigate('/master/shops')}             title="View registered shops" />
              <StatCard label="Active Distributors" value={String(stats.activeDistributors || 0)} delta="+42 onboarded"  isUp={true} color="blue"  onClick={() => navigate('/master/distributors')}      title="View active distributors" />
            </div>

            <div className="two-col">
              {/* Pending Approvals */}
              <div className="card">
                <div className="card-header">
                  <h2 className="section-title">Pending Partner Profile Approvals</h2>
                  <Tag text={`${approvals.length} Pending`} type="red" />
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                  <DataTable columns={approvalColumns} data={approvals} emptyMessage="No pending profiles require approval. All caught up!" />
                </div>
              </div>

              {/* Revenue Models */}
              <div className="card">
                <div className="card-header">
                  <h2 className="section-title">Active Revenue Models & Commission Splits</h2>
                  <button className="btn btn-outline btn-sm" onClick={() => navigate('/master/revenue-models')}>Manage All</button>
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                  <DataTable columns={revModelColumns} data={localRevenueModels} />
                </div>
              </div>
            </div>

            {/* Expenses */}
            <div className="full-col">
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="section-title">Platform Operating Expenses</h2>
                    <p className="section-sub">Expenditure distribution across regional and central categories</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-outline btn-sm"><Download size={12} /> Export CSV</button>
                    <button className="btn btn-outline btn-sm">Filter by State</button>
                  </div>
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                  <DataTable columns={expenseColumns} data={expenses} emptyMessage="No expenses recorded yet." />
                </div>
              </div>
            </div>
          </>
        );
    }
  };

  // ── Inline state-partner form (reused in modal + page) ──
  const renderStatePartnerForm = (form, setForm, onSubmit, onReset, submitting) => (
    <form onSubmit={onSubmit}>
      {/* Location */}
      <h3 className="form-section-title">Location Assignment</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Country <span>*</span></label>
          <select className="form-select" value={form.country} onChange={e => setForm({...form, country: e.target.value})}>
            <option>India</option><option>United States</option><option>United Kingdom</option>
            <option>United Arab Emirates</option><option>Singapore</option><option>Australia</option>
            <option>Canada</option><option>Germany</option><option>Saudi Arabia</option>
            <option>Bangladesh</option><option>Sri Lanka</option><option>Nepal</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Assign State <span>*</span></label>
          <select className="form-select" value={form.state} onChange={e => setForm({...form, state: e.target.value})} required>
            <option value="">Select State</option>
            {['Telangana','Maharashtra','Karnataka','Tamil Nadu','Gujarat','Rajasthan','Kerala','Andhra Pradesh','Delhi','Uttar Pradesh'].map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Personal */}
      <h3 className="form-section-title">Personal Details</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Full Name <span>*</span></label>
          <input className="form-input" type="text" placeholder="Full name" required value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} />
        </div>
        <div className="form-group">
          <label className="form-label">Mobile Number <span>*</span></label>
          <input className="form-input" type="tel" placeholder="+91 XXXXX XXXXX" required value={form.mobile} onChange={e => setForm({...form, mobile: e.target.value})} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Email Address <span>*</span></label>
          <input className="form-input" type="email" placeholder="partner@example.com" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
        </div>
        <div className="form-group">
          <label className="form-label">Date of Birth</label>
          <input className="form-input" type="date" value={form.dob} onChange={e => setForm({...form, dob: e.target.value})} />
        </div>
      </div>

      {/* Business */}
      <h3 className="form-section-title">Business Details</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Business Name</label>
          <input className="form-input" type="text" placeholder="Registered business name" value={form.businessName} onChange={e => setForm({...form, businessName: e.target.value})} />
        </div>
        <div className="form-group">
          <label className="form-label">GST Number</label>
          <input className="form-input" type="text" placeholder="27XXXXX1234X1ZX" value={form.gstNumber} onChange={e => setForm({...form, gstNumber: e.target.value})} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Aadhaar Number <span>*</span></label>
          <input className="form-input" type="text" placeholder="XXXX XXXX XXXX" maxLength={14} required value={form.aadhaarNumber} onChange={e => setForm({...form, aadhaarNumber: e.target.value})} />
          <div style={{ marginTop: '6px' }}>
            <div className="upload-zone" onClick={() => aadhaarFileRef.current?.click()}>
              <span>🪪</span><span>{aadhaarFileName}</span>
            </div>
            <input type="file" ref={aadhaarFileRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setAadhaarFileName(e.target.files[0]?.name || 'Upload Aadhaar Card — PDF / JPG')} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">PAN Number <span>*</span></label>
          <input className="form-input" type="text" placeholder="ABCDE1234F" maxLength={10} required value={form.panNumber} onChange={e => setForm({...form, panNumber: e.target.value})} />
          <div style={{ marginTop: '6px' }}>
            <div className="upload-zone" onClick={() => panFileRef.current?.click()}>
              <span>🪪</span><span>{panFileName}</span>
            </div>
            <input type="file" ref={panFileRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setPanFileName(e.target.files[0]?.name || 'Upload PAN Card — PDF / JPG')} />
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
            <input className="form-input mono" type="number" placeholder="e.g. 5000" value={form.maintenanceCost} onChange={e => setForm({...form, maintenanceCost: e.target.value})} />
            <div className="form-hint">This amount will be <strong>automatically added</strong> to the Expense Tracker every month under "Partner Maintenance"</div>
          </div>
          <div className="form-group">
            <label className="form-label">Annual Total (auto-calculated)</label>
            <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: "'DM Mono', monospace", fontSize: '14px', fontWeight: '600', color: 'var(--amber)' }}>
              {form.maintenanceCost ? `₹${(parseFloat(form.maintenanceCost) * 12).toLocaleString('en-IN')}` : '₹0'}
            </div>
            <div className="form-hint">12 × monthly amount</div>
          </div>
        </div>
      </div>

      {/* Bank */}
      <h3 className="form-section-title">Bank Details</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Bank Name <span>*</span></label>
          <select className="form-select" value={form.bankName} onChange={e => setForm({...form, bankName: e.target.value})} required>
            <option value="">Select Bank</option>
            {['State Bank of India','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra Bank','Punjab National Bank','Bank of Baroda','Canara Bank','Union Bank of India','IndusInd Bank','Yes Bank','Federal Bank','Other'].map(b => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Account Holder Name</label>
          <input className="form-input" type="text" placeholder="As per bank records" value={form.accountHolder} onChange={e => setForm({...form, accountHolder: e.target.value})} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Account Number <span>*</span></label>
          <input className="form-input" type="text" placeholder="Account number" required value={form.accountNumber} onChange={e => setForm({...form, accountNumber: e.target.value})} />
        </div>
        <div className="form-group">
          <label className="form-label">IFSC Code <span>*</span></label>
          <input className="form-input" type="text" placeholder="SBIN0001234" required value={form.ifscCode} onChange={e => setForm({...form, ifscCode: e.target.value})} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Account Type</label>
          <select className="form-select" value={form.accountType} onChange={e => setForm({...form, accountType: e.target.value})}>
            <option value="Savings">Savings Account</option>
            <option value="Current">Current Account</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">UPI ID (optional)</label>
          <input className="form-input" type="text" placeholder="name@upi" value={form.upiId} onChange={e => setForm({...form, upiId: e.target.value})} />
        </div>
      </div>

      {/* Documents */}
      <h3 className="form-section-title">Agreement & Documents</h3>
      <div className="form-group">
        <label className="form-label">Partnership Agreement <span>*</span></label>
        <div className="upload-zone upload-zone-lg" onClick={() => agreementFileRef.current?.click()}>
          <div style={{ fontSize: '22px', marginBottom: '6px' }}>📄</div>
          <div style={{ fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '3px' }}>{agreementFileName}</div>
          <div style={{ fontSize: '11.5px' }}>Signed partnership agreement — PDF, DOC, DOCX up to 10MB</div>
        </div>
        <input type="file" ref={agreementFileRef} accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={e => setAgreementFileName(e.target.files[0]?.name || 'Click to upload or drag & drop')} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Cancelled Cheque / Passbook</label>
          <div className="upload-zone" onClick={() => chequeFileRef.current?.click()}>
            <span style={{ fontSize: '16px' }}>🏦</span><span>{chequeFileName}</span>
          </div>
          <input type="file" ref={chequeFileRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setChequeFileName(e.target.files[0]?.name || 'Attach cancelled cheque (PDF / JPG)')} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn btn-outline" onClick={onReset}>Reset</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Partner'}
        </button>
      </div>
    </form>
  );

  // ── Render ──
  return (
    <DashboardLayout
      role="MASTER"
      badges={badges}
      onLogout={onLogout}
      title="Master Admin Dashboard"
      subtitle={getSubtitle()}
      actionButton={getActionButton()}
    >
      <div className="content">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading dashboard data…</div>
        ) : (
          renderContent()
        )}
      </div>

      {/* ── CREATE STATE PARTNER MODAL ── */}
      <Modal
        isOpen={isStatePartnerOpen}
        onClose={() => setIsStatePartnerOpen(false)}
        title="Create State Partner Profile"
        subtitle="Assign a partner to a state and configure their revenue share per model"
        width="680px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setIsStatePartnerOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleStatePartnerSubmit} disabled={spSubmitting}>
              {spSubmitting ? 'Creating...' : 'Create State Partner'}
            </button>
          </>
        }
      >
        {renderStatePartnerForm(statePartnerForm, setStatePartnerForm, handleStatePartnerSubmit, () => setStatePartnerForm(defaultSPForm), spSubmitting)}
      </Modal>

      {/* ── ADD EXPENSE MODAL ── */}
      <Modal
        isOpen={isExpenseOpen}
        onClose={() => setIsExpenseOpen(false)}
        title="Add Expense"
        subtitle="Record a business expense at master level"
        width="520px"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setIsExpenseOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleExpenseSubmit} disabled={expSubmitting}>
              {expSubmitting ? 'Saving...' : 'Save Expense'}
            </button>
          </>
        }
      >
        <form onSubmit={handleExpenseSubmit}>
          <div className="form-group">
            <label className="form-label">Description <span>*</span></label>
            <input className="form-input" type="text" placeholder="Brief description" required value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Amount (₹) <span>*</span></label>
              <input className="form-input mono" type="number" placeholder="0.00" required value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Date <span>*</span></label>
              <input className="form-input" type="date" required value={expenseForm.date} onChange={e => setExpenseForm({...expenseForm, date: e.target.value})} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-select" value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})}>
                <option value="">Select</option>
                <option value="Marketing">Marketing</option>
                <option value="Operations">Operations</option>
                <option value="Technology">Technology</option>
                <option value="HR & Payroll">HR & Payroll</option>
                <option value="Travel">Travel</option>
                <option value="Infrastructure">Infrastructure</option>
                <option value="Partner Support">Partner Support</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">State</label>
              <select className="form-select" value={expenseForm.state} onChange={e => setExpenseForm({...expenseForm, state: e.target.value})}>
                <option value="">All States</option>
                {['Telangana','Maharashtra','Karnataka','Tamil Nadu','Gujarat','Rajasthan','Kerala','Andhra Pradesh'].map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input" type="text" placeholder="Optional notes" value={expenseForm.notes} onChange={e => setExpenseForm({...expenseForm, notes: e.target.value})} />
          </div>
          <div className="upload-zone upload-zone-lg" style={{ textAlign: 'center' }} onClick={() => expReceiptRef.current?.click()}>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>📎</div>
            <div style={{ fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '3px' }}>{expReceiptName}</div>
            <div style={{ fontSize: '11px' }}>PDF, PNG, JPG up to 5MB</div>
            <input type="file" ref={expReceiptRef} accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setExpReceiptName(e.target.files[0]?.name || 'Attach Receipt')} />
          </div>
        </form>
      </Modal>

      {/* ── CREATE REVENUE MODEL MODAL ── */}
      <Modal
        isOpen={isRevenueModelOpen}
        onClose={() => setIsRevenueModelOpen(false)}
        title="Create Platform Revenue & Split Model"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setIsRevenueModelOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleRevModelSave}>Save Model</button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Revenue Model Name <span>*</span></label>
          <input className="form-input" type="text" placeholder="E.g. Groceries Shop Subscription" required value={revModelForm.name} onChange={e => setRevModelForm({...revModelForm, name: e.target.value})} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Charge Category <span>*</span></label>
            <select className="form-select" value={revModelForm.category} onChange={e => setRevModelForm({...revModelForm, category: e.target.value})}>
              <option value="partnership">Partnership Fee</option>
              <option value="shop">Shop Subscription</option>
              <option value="delivery">Delivery Subscription</option>
              <option value="distributor">Distributor Subscription</option>
              <option value="manufacturer">Manufacturer Subscription</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Base Charge Setup <span>*</span></label>
            <input className="form-input" type="text" placeholder="E.g. ₹999/mo or Fixed %" required value={revModelForm.charge} onChange={e => setRevModelForm({...revModelForm, charge: e.target.value})} />
          </div>
        </div>
        <h3 className="form-section-title">Cascading Revenue Split Configurations</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Regional Partner Share (%)</label>
            <input className="form-input" type="number" placeholder="25" value={revModelForm.RP} onChange={e => setRevModelForm({...revModelForm, RP: e.target.value})} />
          </div>
          <div className="form-group">
            <label className="form-label">District Partner Share (%)</label>
            <input className="form-input" type="number" placeholder="20" value={revModelForm.DP} onChange={e => setRevModelForm({...revModelForm, DP: e.target.value})} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Industry State Partner Share (%)</label>
            <input className="form-input" type="number" placeholder="15" value={revModelForm.ISP} onChange={e => setRevModelForm({...revModelForm, ISP: e.target.value})} />
          </div>
          <div className="form-group">
            <label className="form-label">State Partner Share (%)</label>
            <input className="form-input" type="number" placeholder="10" value={revModelForm.SP} onChange={e => setRevModelForm({...revModelForm, SP: e.target.value})} />
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
};

export default MasterDashboard;
