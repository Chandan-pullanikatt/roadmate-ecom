import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StatCard from '../components/ui/StatCard';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Tag from '../components/ui/Tag';
import { Plus, Download, Check, X, ArrowRight, Camera } from 'lucide-react';
import {
  getOverviewStats,
  getProducts,
  createProduct,
  getOrders,
  updateOrderStatus,
} from '../utils/api';

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

const BULK_BUYER_ROLES = ['STATE', 'IND_STATE', 'DISTRICT', 'MASTER'];

const ManufacturerDashboard = ({ onLogout }) => {
  const { pathname } = useLocation();
  const navigate     = useNavigate();
  const user         = JSON.parse(localStorage.getItem('roadmate_user') || '{}');
  const userId       = user.id;
  const mfrName      = user.businessName || user.name || 'Manufacturer';

  /* ── State ── */
  const [stats,           setStats]           = useState({});
  const [products,        setProducts]        = useState([]);
  const [sellerOrders,    setSellerOrders]    = useState([]);
  const [distOrders,      setDistOrders]      = useState([]);
  const [bulkOrders,      setBulkOrders]      = useState([]);
  const [retailOrders,    setRetailOrders]    = useState([]);
  const [badges,          setBadges]          = useState({
    products: 0, distributorOrders: 0, distributors: 0, distributorRequests: 0, staff: 0
  });

  /* ── Modals ── */
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [branchModalOpen,  setBranchModalOpen]  = useState(false);
  const [staffModalOpen,   setStaffModalOpen]   = useState(false);

  /* ── Product form ── */
  const [productForm, setProductForm] = useState({
    name: '', sku: '', category: '', subCategory: '', description: '',
    mrp: '', distPrice: '', retailPrice: '', moq: '1', stock: '', lowStockAlert: '10',
    dispatchLocation: '', leadTime: '1-2 days'
  });

  /* ── Load ── */
  const refreshDashboard = async () => {
    try {
      const [ovData, prodData, ordData] = await Promise.all([
        getOverviewStats(),
        getProducts(),
        getOrders(),
      ]);

      const s   = ovData.stats   || {};
      const prd = prodData.products || [];
      const all = ordData.orders || [];

      /* Categorise orders where this manufacturer is the seller */
      const sellerOrders = all.filter(o => o.sellerId === userId);
      const dOrders = sellerOrders.filter(o => o.buyer?.role === 'DISTRIBUTOR');
      const bOrders = sellerOrders.filter(o => BULK_BUYER_ROLES.includes(o.buyer?.role || ''));
      const rOrders = sellerOrders.filter(o => o.buyer?.role === 'SHOP');

      setStats(s);
      setProducts(prd);
      setSellerOrders(sellerOrders);
      setDistOrders(dOrders);
      setBulkOrders(bOrders);
      setRetailOrders(rOrders);
      setBadges({
        products:          prd.length,
        distributorOrders: dOrders.filter(o => o.status === 'Pending').length,
        distributors:      s.activeDealers || 0,
        distributorRequests: 0,
        staff:             0,
      });
    } catch (err) {
      console.error('Manufacturer dashboard load error:', err);
    }
  };

  useEffect(() => { refreshDashboard(); }, []);

  /* Auto-open modals when navigated via sidebar links */
  useEffect(() => {
    if (pathname === '/manufacturer/add-product') setProductModalOpen(true);
    else if (pathname === '/manufacturer/branches')  setBranchModalOpen(true);
    else if (pathname === '/manufacturer/add-staff') setStaffModalOpen(true);
  }, [pathname]);

  const handleModalClose = () => {
    setProductModalOpen(false);
    setBranchModalOpen(false);
    setStaffModalOpen(false);
  };

  /* ── Submit product ── */
  const handleProductSubmit = async (e) => {
    if (e) e.preventDefault();
    try {
      await createProduct({
        name:        productForm.name,
        sku:         productForm.sku,
        price:       parseFloat(productForm.distPrice || productForm.mrp) || 0,
        description: productForm.description
          ? `[${productForm.category || 'General'}] ${productForm.description}`
          : productForm.category || '',
        stockLevel:  parseInt(productForm.stock) || 0,
        industryId:  user.industryId,
      });
      handleModalClose();
      setProductForm({
        name: '', sku: '', category: '', subCategory: '', description: '',
        mrp: '', distPrice: '', retailPrice: '', moq: '1', stock: '', lowStockAlert: '10',
        dispatchLocation: '', leadTime: '1-2 days'
      });
      await refreshDashboard();
    } catch (err) {
      console.error('Create product error:', err);
    }
  };

  /* ── Dispatch order ── */
  const handleDispatch = async (orderId) => {
    try {
      await updateOrderStatus(orderId, 'Dispatched');
      await refreshDashboard();
    } catch (err) {
      console.error('Dispatch error:', err);
    }
  };

  /* ── Column definitions ── */
  const productColumns = [
    {
      header: '',
      render: () => <div className="product-img-placeholder">🔧</div>
    },
    {
      header: 'Product Name',
      render: (row) => (
        <div>
          <div style={{ fontWeight: '500' }}>{row.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {row.industry?.name || '—'}
          </div>
        </div>
      )
    },
    { header: 'SKU', render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)' }}>{row.sku || '—'}</span> },
    { header: 'Category', render: (row) => <Tag text={row.industry?.name || 'General'} type="purple" /> },
    { header: 'MRP', render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>₹{(row.price || 0).toLocaleString('en-IN')}</span> },
    {
      header: 'Distributor Price',
      render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '500' }}>₹{(row.price || 0).toLocaleString('en-IN')}</span>
    },
    {
      header: 'Stock',
      render: (row) => (
        <span style={{
          fontFamily: 'DM Mono, monospace', fontWeight: '500',
          color: row.stockLevel <= 10 ? 'var(--red)' : 'inherit'
        }}>
          {row.stockLevel ?? '—'} units
        </span>
      )
    },
    {
      header: 'Status',
      render: (row) => (
        <Tag
          text={(row.stockLevel ?? 0) <= 10 ? 'Low Stock' : 'Active'}
          type={(row.stockLevel ?? 0) <= 10 ? 'red' : 'green'}
        />
      )
    },
  ];

  const distOrderColumns = [
    { header: 'Order ID',      render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.orderNumber}</span> },
    { header: 'Distributor',   render: (row) => <span style={{ fontWeight: '500' }}>{row.buyer?.businessName || row.buyer?.name || '—'}</span> },
    { header: 'Items',         render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.items?.length ?? '—'}</span> },
    { header: 'Region',        render: (row) => <Tag text={row.buyer?.regionName || '—'} type="teal" /> },
    { header: 'Amount',        render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '600', color: 'var(--accent)' }}>{formatRupees(row.totalAmount)}</span> },
    {
      header: 'Status',
      render: (row) => (
        <Tag
          text={row.status}
          type={row.status === 'Pending' ? 'amber' : row.status === 'Dispatched' ? 'blue' : 'green'}
        />
      )
    },
    {
      header: 'Action',
      render: (row) => row.status === 'Pending' ? (
        <button className="btn btn-outline btn-sm" onClick={() => handleDispatch(row.id)}>Dispatch</button>
      ) : (
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ready</span>
      )
    },
  ];

  const bulkOrderColumns = [
    { header: 'Order ID', render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.orderNumber}</span> },
    { header: 'Buyer',    render: (row) => <span style={{ fontWeight: '500' }}>{row.buyer?.businessName || row.buyer?.name || '—'}</span> },
    { header: 'Items',    render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.items?.length ?? '—'}</span> },
    { header: 'Amount',   render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '600', color: 'var(--blue)' }}>{formatRupees(row.totalAmount)}</span> },
    {
      header: 'Status',
      render: (row) => <Tag text={row.status} type={row.status === 'Pending' ? 'amber' : row.status === 'Dispatched' ? 'blue' : 'green'} />
    },
  ];

  const retailOrderColumns = [
    { header: 'Order ID', render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.orderNumber}</span> },
    { header: 'Shop',     render: (row) => <span style={{ fontWeight: '500' }}>{row.buyer?.businessName || row.buyer?.name || '—'}</span> },
    { header: 'Items',    render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.items?.length ?? '—'}</span> },
    { header: 'Region',   render: (row) => <Tag text={row.buyer?.regionName || '—'} type="teal" /> },
    { header: 'Amount',   render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '500', color: 'var(--accent)' }}>{formatRupees(row.totalAmount)}</span> },
    {
      header: 'Status',
      render: (row) => <Tag text={row.status} type={row.status === 'Pending' ? 'amber' : row.status === 'Dispatched' ? 'blue' : 'green'} />
    },
  ];

  const staffColumns = [
    {
      header: 'Field Staff Name',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="approval-avatar" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
            {initials(row.name)}
          </div>
          <div style={{ fontWeight: '500' }}>{row.name}</div>
        </div>
      )
    },
    { header: 'Role Profile',       render: (row) => <Tag text={row.businessName || 'Staff'} type="blue" /> },
    { header: 'Assigned Region',    render: (row) => <span>{row.regionName || '—'}</span> },
    { header: 'Status',             render: (row) => <Tag text="Active" type="green" /> },
  ];

  /* ── Order-status derived lists (match the overview stat counts) ── */
  const PENDING_STATUSES = ['Pending', 'Approved', 'Dispatched'];
  const fulfilledOrders   = sellerOrders.filter(o => o.status === 'Delivered');
  const pendingOrdersList = sellerOrders.filter(o => PENDING_STATUSES.includes(o.status));
  const retailOutletCount = new Set(retailOrders.map(o => o.buyerId)).size;

  const BUYER_TYPE_LABEL = {
    DISTRIBUTOR: 'Distributor', SHOP: 'Retail',
    STATE: 'State', IND_STATE: 'Industry State', DISTRICT: 'District', MASTER: 'Master',
  };
  const statusTagType = (s) => (s === 'Pending' ? 'amber' : s === 'Dispatched' ? 'blue' : s === 'Delivered' ? 'green' : 'teal');

  /* Generic order columns (used by the all-orders status pages) */
  const allOrderColumns = [
    { header: 'Order ID', render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.orderNumber}</span> },
    { header: 'Buyer',    render: (row) => <span style={{ fontWeight: '500' }}>{row.buyer?.businessName || row.buyer?.name || '—'}</span> },
    { header: 'Type',     render: (row) => <Tag text={BUYER_TYPE_LABEL[row.buyer?.role] || '—'} type="purple" /> },
    { header: 'Items',    render: (row) => <span style={{ fontFamily: 'DM Mono, monospace' }}>{row.items?.length ?? '—'}</span> },
    { header: 'Amount',   render: (row) => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '600', color: 'var(--accent)' }}>{formatRupees(row.totalAmount)}</span> },
    { header: 'Status',   render: (row) => <Tag text={row.status} type={statusTagType(row.status)} /> },
  ];
  const pendingOrderColumns = [
    ...allOrderColumns,
    {
      header: 'Action',
      render: (row) => row.status === 'Pending'
        ? <button className="btn btn-outline btn-sm" onClick={() => handleDispatch(row.id)}>Dispatch</button>
        : <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{row.status}</span>
    },
  ];

  /* Section header with a back-to-dashboard link (for routes not in the sidebar) */
  const renderPageHeader = (title, sub, right) => (
    <div className="card-header">
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="section-sub">
          <a style={{ cursor: 'pointer', color: 'var(--brand)' }} onClick={() => navigate('/manufacturer')}>‹ Dashboard</a>
          {sub ? <> · {sub}</> : null}
        </p>
      </div>
      {right}
    </div>
  );

  /* ── Render content ── */
  const renderContent = () => {
    switch (pathname) {

      /* ── PRODUCTS LIST ── */
      case '/manufacturer/products':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Product Listing — {mfrName}</h2>
                <p className="section-sub">All {products.length} products listed on the RoadMate platform</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setProductModalOpen(true)}>
                <Plus size={12} /> Add Product
              </button>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={productColumns} data={products} />
            </div>
          </div>
        );

      /* ── ORDERS: DISTRIBUTORS ── */
      case '/manufacturer/orders-distributors':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Orders from Distributors</h2>
                <p className="section-sub">All distributor orders — pending, dispatched, delivered</p>
              </div>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={distOrderColumns} data={distOrders} />
            </div>
          </div>
        );

      /* ── ORDERS: BULK / STATE ── */
      case '/manufacturer/orders-bulk':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Orders from State / District</h2>
                <p className="section-sub">Bulk procurement orders from state and district partners</p>
              </div>
              <button className="btn btn-outline btn-sm"><Download size={12} /> Invoice PDF</button>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={bulkOrderColumns} data={bulkOrders} />
            </div>
          </div>
        );

      /* ── ORDERS: RETAIL ── */
      case '/manufacturer/orders-retail':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Orders from Retail Outlets</h2>
                <p className="section-sub">Direct orders from registered shops on the platform</p>
              </div>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={retailOrderColumns} data={retailOrders} />
            </div>
          </div>
        );

      /* ── DISTRIBUTORS ── */
      case '/manufacturer/distributors':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Distributors — {mfrName}</h2>
                <p className="section-sub">All distributors authorized to carry your products</p>
              </div>
              <Tag text={`${stats.activeDealers || 0} Active`} type="green" />
            </div>
            <div className="card-body" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {stats.activeDealers
                ? `${stats.activeDealers} distributor(s) mapped via the RoadMate platform.`
                : 'No distributors mapped yet. Distributors can request to carry your products.'}
            </div>
          </div>
        );

      /* ── DISTRIBUTOR REQUESTS ── */
      case '/manufacturer/distributor-requests':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Distributor Requests</h2>
                <p className="section-sub">Distributors applying to carry your products — approve or reject</p>
              </div>
              <Tag text="0 Pending" type="amber" />
            </div>

            <div className="info-box" style={{ margin: '16px 20px', background: 'var(--brand-light)', borderColor: '#DDD6FE', color: '#4C1D95' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="8" cy="8" r="6" stroke="#4C1D95" strokeWidth="1.4" />
                <path d="M8 7v4" stroke="#4C1D95" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>
                Distributors on the RoadMate platform can request to carry your products.
                Approve them to add them to your distribution network.
              </span>
            </div>

            <div className="card-body" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              No pending distributor requests at this time.
            </div>
          </div>
        );

      /* ── FIELD STAFF ── */
      case '/manufacturer/staff':
        return (
          <div className="card full-col">
            <div className="card-header">
              <div>
                <h2 className="section-title">Field Staff — {mfrName}</h2>
                <p className="section-sub">All field staff members across regions</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setStaffModalOpen(true)}>
                <Plus size={12} /> Add Staff
              </button>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={staffColumns} data={[]} />
            </div>
          </div>
        );

      /* ── SALES SUMMARY ── */
      case '/manufacturer/sales': {
        const distTotal   = distOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
        const bulkTotal   = bulkOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
        const retailTotal = retailOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
        const salesRows = [
          { channel: '📦 Distributor Orders', count: distOrders.length,   amount: distTotal,   color: 'var(--accent)' },
          { channel: '🏢 State / District (Bulk)', count: bulkOrders.length, amount: bulkTotal, color: 'var(--blue)' },
          { channel: '🏪 Retail Outlets (Direct)', count: retailOrders.length, amount: retailTotal, color: 'var(--teal)' },
        ];
        return (
          <div className="card full-col">
            {renderPageHeader('Sales Summary', `Total order value across all channels — ${mfrName}`,
              <Tag text={formatRupees(stats.totalSales || 0)} type="purple" />)}
            <div className="card-body" style={{ padding: '0' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sales Channel</th>
                    <th style={{ textAlign: 'right' }}>Orders</th>
                    <th style={{ textAlign: 'right' }}>Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {salesRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.channel}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{r.count}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', fontWeight: '600', color: r.color }}>{formatRupees(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '24px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Order Value:&nbsp;
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: '700', fontSize: '15px', color: 'var(--purple)' }}>{formatRupees(stats.totalSales || 0)}</span>
              </span>
            </div>
          </div>
        );
      }

      /* ── ORDERS FULFILLED ── */
      case '/manufacturer/orders-fulfilled':
        return (
          <div className="card full-col">
            {renderPageHeader('Fulfilled Orders', 'All delivered orders across every channel',
              <Tag text={`${fulfilledOrders.length} Delivered`} type="green" />)}
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={allOrderColumns} data={fulfilledOrders} />
            </div>
          </div>
        );

      /* ── PENDING ORDERS ── */
      case '/manufacturer/orders-pending':
        return (
          <div className="card full-col">
            {renderPageHeader('Pending Orders', 'Orders awaiting dispatch or delivery across every channel',
              <Tag text={`${pendingOrdersList.length} Pending`} type="amber" />)}
            <div className="card-body" style={{ padding: '0' }}>
              <DataTable columns={pendingOrderColumns} data={pendingOrdersList} />
            </div>
          </div>
        );

      /* ── BRANCHES ── */
      case '/manufacturer/branch-list':
        return (
          <div className="card full-col">
            {renderPageHeader('Branches', 'Your branch & warehouse network',
              <button className="btn btn-primary btn-sm" onClick={() => setBranchModalOpen(true)}>
                <Plus size={12} /> Add Branch
              </button>)}
            <div className="card-body" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No branches added yet. Use “Add Branch” to register a warehouse or sales branch.
            </div>
          </div>
        );

      /* ── OVERVIEW (default — also handles modal route triggers) ── */
      default:
        return (
          <>
            {/* Stats Row 1 */}
            <div className="stat-grid">
              <StatCard
                label="Total Order Value"
                value={formatRupees(stats.totalSales || 0)}
                delta={stats.totalSales ? '↑ vs last month' : 'No orders yet'}
                isUp={true}
                color="purple"
                onClick={() => navigate('/manufacturer/sales')}
                title="View sales summary"
              />
              <StatCard
                label="Orders Fulfilled"
                value={(stats.completedOrders || 0).toString()}
                delta="Delivered orders"
                isUp={true}
                color="green"
                onClick={() => navigate('/manufacturer/orders-fulfilled')}
                title="View fulfilled orders"
              />
              <StatCard
                label="Active Distributors"
                value={(stats.activeDealers || 0).toString()}
                delta="Mapped on platform"
                isUp={true}
                color="amber"
                onClick={() => navigate('/manufacturer/distributors')}
                title="View distributors"
              />
              <StatCard
                label="Pending Orders"
                value={(stats.pendingOrders || 0).toString()}
                delta={stats.pendingOrders ? '⚠ Awaiting dispatch' : 'All clear'}
                isUp={false}
                color="red"
                onClick={() => navigate('/manufacturer/orders-pending')}
                title="View pending orders"
              />
            </div>

            {/* Stats Row 2 */}
            <div className="stat-grid">
              <StatCard
                label="Products Listed"
                value={(stats.catalogProducts ?? products.length).toString()}
                delta="Active catalog"
                isUp={true}
                color="blue"
                onClick={() => navigate('/manufacturer/products')}
                title="View products"
              />
              <StatCard
                label="Retail Outlets (Direct)"
                value={retailOutletCount.toString()}
                delta="Ordering directly"
                isUp={true}
                color="teal"
                onClick={() => navigate('/manufacturer/orders-retail')}
                title="View retail orders"
              />
              <StatCard
                label="Field Staff"
                value="0"
                delta="Active across regions"
                isUp={true}
                color="purple"
                onClick={() => navigate('/manufacturer/staff')}
                title="View field staff"
              />
              <StatCard
                label="Branches"
                value="0"
                delta="Regional spare hubs"
                isUp={true}
                color="green"
                onClick={() => navigate('/manufacturer/branch-list')}
                title="View branches"
              />
            </div>

            {/* 3-col order summary */}
            <div className="three-col">
              {/* Distributor Orders */}
              <div className="card">
                <div className="card-header">
                  <h3 className="section-title" style={{ fontSize: '13px' }}>Orders from Distributors</h3>
                  <Tag text={`${distOrders.filter(o => o.status === 'Pending').length} Pending`} type="purple" />
                </div>
                <div className="card-body" style={{ padding: '0 0 8px' }}>
                  {distOrders.length === 0 ? (
                    <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: '12px' }}>No distributor orders yet.</div>
                  ) : (
                    distOrders.slice(0, 4).map(o => (
                      <div key={o.id} style={{ padding: '12px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '500' }}>{o.buyer?.businessName || o.buyer?.name || '—'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{o.items?.length || 0} items · {o.buyer?.regionName || '—'}</div>
                        </div>
                        <div style={{ fontWeight: '600', fontFamily: 'DM Mono, monospace', color: 'var(--accent)' }}>
                          {formatRupees(o.totalAmount)}
                        </div>
                      </div>
                    ))
                  )}
                  <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', marginTop: '12px' }}>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => navigate('/manufacturer/orders-distributors')}
                    >
                      View All Orders <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Bulk / State Orders */}
              <div className="card">
                <div className="card-header">
                  <h3 className="section-title" style={{ fontSize: '13px' }}>Orders from State / District</h3>
                  <Tag text="Bulk Orders" type="blue" />
                </div>
                <div className="card-body" style={{ padding: '0 0 8px' }}>
                  {bulkOrders.length === 0 ? (
                    <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: '12px' }}>No bulk orders yet.</div>
                  ) : (
                    bulkOrders.slice(0, 3).map(o => (
                      <div key={o.id} style={{ padding: '12px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '500' }}>{o.buyer?.businessName || o.buyer?.name || '—'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{o.items?.length || 0} items</div>
                        </div>
                        <div style={{ fontWeight: '600', fontFamily: 'DM Mono, monospace', color: 'var(--blue)' }}>
                          {formatRupees(o.totalAmount)}
                        </div>
                      </div>
                    ))
                  )}
                  <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', marginTop: '12px' }}>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => navigate('/manufacturer/orders-bulk')}
                    >
                      View All <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Retail Orders */}
              <div className="card">
                <div className="card-header">
                  <h3 className="section-title" style={{ fontSize: '13px' }}>Orders from Retail Outlets</h3>
                  <Tag text="Direct" type="green" />
                </div>
                <div className="card-body" style={{ padding: '0 0 8px' }}>
                  {retailOrders.length === 0 ? (
                    <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: '12px' }}>No retail orders yet.</div>
                  ) : (
                    retailOrders.slice(0, 3).map(o => (
                      <div key={o.id} style={{ padding: '12px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '500' }}>{o.buyer?.businessName || o.buyer?.name || '—'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{o.items?.length || 0} items · {o.buyer?.regionName || '—'}</div>
                        </div>
                        <div style={{ fontWeight: '600', fontFamily: 'DM Mono, monospace', color: 'var(--accent)' }}>
                          {formatRupees(o.totalAmount)}
                        </div>
                      </div>
                    ))
                  )}
                  <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', marginTop: '12px' }}>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => navigate('/manufacturer/orders-retail')}
                    >
                      View All <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Products */}
            <div className="section-header" style={{ marginTop: '4px' }}>
              <div>
                <h3 className="section-title">Top Selling Products</h3>
                <p className="section-sub">Your best-performing products on the platform this month</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setProductModalOpen(true)}>
                <Plus size={11} /> Add Product
              </button>
            </div>
            <div className="card full-col">
              <div className="card-body" style={{ padding: '0' }}>
                <DataTable
                  columns={productColumns.slice(0, 6)}
                  data={products.slice(0, 5)}
                />
              </div>
            </div>

            {/* Distributor Requests */}
            <div className="section-header" style={{ marginTop: '4px' }}>
              <div>
                <h3 className="section-title">Distributor Requests</h3>
                <p className="section-sub">Distributors applying to carry your products — approve or reject</p>
              </div>
              <span style={{ background: 'var(--amber-light)', color: 'var(--amber)', fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px' }}>
                0 Pending
              </span>
            </div>
            <div className="card full-col">
              <div className="card-body" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No pending distributor requests at this time.
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <DashboardLayout
      role="MANUFACTURER"
      badges={badges}
      onLogout={onLogout}
      title="Manufacturer Dashboard"
      subtitle={`${mfrName} · Products, Orders & Distribution`}
      locationChain={[
        { type: 'state', label: user.stateName   || 'State' },
        { type: 'ind',   label: user.industry?.name || 'Industry' },
        { type: 'mfr',   label: mfrName },
      ]}
      actionButton={
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline" onClick={() => setBranchModalOpen(true)}>
            <Plus size={14} /> Add Branch
          </button>
          <button className="btn btn-outline" onClick={() => setStaffModalOpen(true)}>
            <Plus size={14} /> Add Staff
          </button>
          <button className="btn btn-primary" onClick={() => setProductModalOpen(true)}>
            <Plus size={14} /> Add Product
          </button>
        </div>
      }
    >
      <div className="content">
        {renderContent()}
      </div>

      {/* ── ADD PRODUCT MODAL ── */}
      <Modal
        isOpen={productModalOpen}
        onClose={handleModalClose}
        title="Add Product Listing"
        subtitle="List a new product on the RoadMate platform for distributors and retail outlets"
        width="800px"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleProductSubmit}>Publish Product</button>
          </>
        }
      >
        <h3 className="form-section-title">Product Information</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Product Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="e.g. Tata Nexon EV Spares Kit"
              value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">SKU / Part Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="e.g. TML-NEX-EV-001"
              value={productForm.sku} onChange={e => setProductForm({ ...productForm, sku: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select"
              value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })}>
              <option value="">Select Category</option>
              <option value="Cars &amp; SUVs">Cars &amp; SUVs</option>
              <option value="Spares &amp; Parts">Spares &amp; Parts</option>
              <option value="Accessories">Accessories</option>
              <option value="Tyres &amp; Wheels">Tyres &amp; Wheels</option>
              <option value="EV Components">EV Components</option>
              <option value="Commercial Vehicle Parts">Commercial Vehicle Parts</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Sub-category</label>
            <input type="text" className="form-input" placeholder="e.g. EV Battery Spares"
              value={productForm.subCategory} onChange={e => setProductForm({ ...productForm, subCategory: e.target.value })} />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: '14px' }}>
          <label className="form-label">Product Description</label>
          <textarea className="form-input" rows="3"
            placeholder="Describe the product — specifications, compatibility, use case…"
            style={{ resize: 'vertical' }}
            value={productForm.description}
            onChange={e => setProductForm({ ...productForm, description: e.target.value })} />
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Pricing</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">MRP (₹) <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="number" className="form-input" placeholder="Maximum Retail Price"
              value={productForm.mrp} onChange={e => setProductForm({ ...productForm, mrp: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Distributor Price (₹) <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="number" className="form-input" placeholder="Price offered to distributors"
              value={productForm.distPrice} onChange={e => setProductForm({ ...productForm, distPrice: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Retail Outlet Price (₹)</label>
            <input type="number" className="form-input" placeholder="Direct-to-shop price (if applicable)"
              value={productForm.retailPrice} onChange={e => setProductForm({ ...productForm, retailPrice: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Minimum Order Quantity</label>
            <input type="number" className="form-input" placeholder="Min qty per order"
              value={productForm.moq} onChange={e => setProductForm({ ...productForm, moq: e.target.value })} />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Stock &amp; Availability</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Current Stock <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="number" className="form-input" placeholder="Available units"
              value={productForm.stock} onChange={e => setProductForm({ ...productForm, stock: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Low Stock Alert at</label>
            <input type="number" className="form-input" placeholder="Alert when stock below…"
              value={productForm.lowStockAlert} onChange={e => setProductForm({ ...productForm, lowStockAlert: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Dispatch Location</label>
            <select className="form-select"
              value={productForm.dispatchLocation} onChange={e => setProductForm({ ...productForm, dispatchLocation: e.target.value })}>
              <option value="">Select Branch</option>
              <option>Main Warehouse</option>
              <option>Regional Branch</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Delivery Lead Time</label>
            <select className="form-select"
              value={productForm.leadTime} onChange={e => setProductForm({ ...productForm, leadTime: e.target.value })}>
              <option value="1-2 days">1-2 Business Days</option>
              <option value="2-3 days">2-3 Business Days</option>
              <option value="3-5 days">3-5 Business Days</option>
              <option value="5-7 days">5-7 Business Days</option>
            </select>
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Product Images</h3>
        <div className="upload-zone-lg" style={{ textAlign: 'center', padding: '24px' }}>
          <Camera size={28} style={{ opacity: 0.5, margin: '0 auto 8px', display: 'block' }} />
          <div style={{ fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            Click to upload product images
          </div>
          <div style={{ fontSize: '12px' }}>PNG, JPG up to 5MB each · Max 6 images</div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Distributor Visibility</h3>
        <div className="form-group">
          <label className="form-label">Make visible to</label>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="radio" name="visibility" defaultChecked style={{ accentColor: 'var(--brand)' }} />
              <span>All authorized distributors</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="radio" name="visibility" style={{ accentColor: 'var(--brand)' }} />
              <span>Selected distributors only</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="radio" name="visibility" style={{ accentColor: 'var(--brand)' }} />
              <span>Direct to retail outlets (bypass distributors)</span>
            </label>
          </div>
        </div>
      </Modal>

      {/* ── ADD BRANCH MODAL ── */}
      <Modal
        isOpen={branchModalOpen}
        onClose={handleModalClose}
        title="Add Branch"
        subtitle="Add a new branch / warehouse location"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleModalClose}>Add Branch</button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Branch Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="e.g. Karimnagar Branch" />
          </div>
          <div className="form-group">
            <label className="form-label">Branch Type</label>
            <select className="form-select">
              <option>Sales Branch</option>
              <option>Warehouse</option>
              <option>Service Centre</option>
              <option>Head Office</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">City <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="City" />
          </div>
          <div className="form-group">
            <label className="form-label">District <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="District" />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: '14px' }}>
          <label className="form-label">Full Address <span style={{ color: 'var(--red)' }}>*</span></label>
          <textarea className="form-input" rows="2" placeholder="Full address with pincode" style={{ resize: 'vertical' }} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Branch Manager</label>
            <input type="text" className="form-input" placeholder="Manager's name" />
          </div>
          <div className="form-group">
            <label className="form-label">Contact Number</label>
            <input type="tel" className="form-input" placeholder="+91 XXXXX XXXXX" />
          </div>
        </div>
      </Modal>

      {/* ── ADD FIELD STAFF MODAL ── */}
      <Modal
        isOpen={staffModalOpen}
        onClose={handleModalClose}
        title="Add Field Staff Profile"
        subtitle={`Create a profile for a new field staff member — ${mfrName}`}
        width="700px"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleModalClose}>Create Staff Profile</button>
          </>
        }
      >
        <h3 className="form-section-title">Personal Details</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Full Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="Full name" />
          </div>
          <div className="form-group">
            <label className="form-label">Employee ID</label>
            <input type="text" className="form-input" placeholder="e.g. TML-HYD-042" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="tel" className="form-input" placeholder="+91 XXXXX XXXXX" />
          </div>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input type="email" className="form-input" placeholder="staff@company.com" />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Assignment</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Role <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select">
              <option value="">Select Role</option>
              <option>Sales Executive</option>
              <option>Field Officer</option>
              <option>Technical Support</option>
              <option>Delivery Coordinator</option>
              <option>Branch Manager</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Assigned Branch <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select">
              <option value="">Select Branch</option>
              <option>Main Warehouse</option>
              <option>Regional Branch</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Assigned Region</label>
            <input type="text" className="form-input" placeholder="e.g. Banjara Hills" />
          </div>
          <div className="form-group">
            <label className="form-label">Monthly Target</label>
            <input type="text" className="form-input" placeholder="e.g. 40 distributor visits / month" />
          </div>
        </div>

        <div className="form-divider" />
        <h3 className="form-section-title">Documents</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Aadhaar <span style={{ color: 'var(--red)' }}>*</span></label>
            <div className="upload-zone">🪪 Upload Aadhaar</div>
          </div>
          <div className="form-group">
            <label className="form-label">Appointment Letter</label>
            <div className="upload-zone">📄 Upload Appointment Letter</div>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
};

export default ManufacturerDashboard;
