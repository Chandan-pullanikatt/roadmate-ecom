import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StatCard from '../components/ui/StatCard';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Tag from '../components/ui/Tag';
import {
  getOverviewStats, getProducts, getOrders,
  createProduct, updateOrderStatus, getActivePartners
} from '../utils/api';

const formatRupees = (n) => {
  if (!n && n !== 0) return '₹0';
  const num = parseFloat(n);
  if (num >= 1e7) return `₹${(num / 1e7).toFixed(1)}Cr`;
  if (num >= 1e5) return `₹${(num / 1e5).toFixed(1)}L`;
  if (num >= 1e3) return `₹${(num / 1e3).toFixed(0)}K`;
  return `₹${num}`;
};

const initials = (name = '') =>
  name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';

const orderTotal = (order) => {
  if (order.totalAmount) return parseFloat(order.totalAmount);
  if (order.items?.length) return order.items.reduce((s, i) => s + ((i.price || 0) * (i.quantity || 1)), 0);
  return 0;
};

const DistributorDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userId = user.id;
  const distName = user.businessName || user.name || 'Distributor';

  // ── Data state ────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({});
  const [products, setProducts] = useState([]);
  const [retailOrders, setRetailOrders] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [linkedManufacturers, setLinkedManufacturers] = useState([]);
  const [retailOutlets, setRetailOutlets] = useState([]);

  const [badges, setBadges] = useState({ retailOrders: 0, manufacturers: 0, outlets: 0, staff: 0 });

  // ── Modal states ──────────────────────────────────────────────────────────
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [ownProductModalOpen, setOwnProductModalOpen] = useState(false);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [requestMfrModalOpen, setRequestMfrModalOpen] = useState(false);

  // ── Own-product form ──────────────────────────────────────────────────────
  const [ownProductForm, setOwnProductForm] = useState({
    name: '', brand: '', category: '', sku: '', description: '',
    sellingPrice: '', mrp: '', stock: '', moq: '1'
  });

  // ── PO visual state ───────────────────────────────────────────────────────
  const [poSelectedMfr, setPoSelectedMfr] = useState(0);
  const [poRequiredDate, setPoRequiredDate] = useState('');
  const [poInstructions, setPoInstructions] = useState('');
  const [poPayment, setPoPayment] = useState('Credit (Net 30 days)');
  const [poItems, setPoItems] = useState([
    { id: 1, name: 'Product A', sku: 'SKU-001', price: 1000, qty: 10 },
    { id: 2, name: 'Product B', sku: 'SKU-002', price: 500, qty: 20 },
    { id: 3, name: 'Product C', sku: 'SKU-003', price: 2000, qty: 5 }
  ]);
  const calcPoTotal = () => poItems.reduce((s, i) => s + i.price * i.qty, 0);
  const handlePoQtyChange = (id, val) =>
    setPoItems(prev => prev.map(i => i.id === id ? { ...i, qty: Math.max(0, parseInt(val) || 0) } : i));

  // ── Load data ─────────────────────────────────────────────────────────────
  const refreshDashboard = async () => {
    try {
      const [ovData, prodData, ordData, partData] = await Promise.all([
        getOverviewStats(),
        getProducts(),
        getOrders(),
        getActivePartners()
      ]);

      const s = ovData.stats || {};
      setStats(s);

      setProducts(prodData.products || []);

      const all = ordData.orders || [];
      const rOrders = all.filter(o => o.sellerId === userId);
      const pOrders = all.filter(o => o.buyerId === userId);
      setRetailOrders(rOrders);
      setPurchaseOrders(pOrders);

      // Derive linked manufacturers from unique sellers in purchase orders
      const mfrMap = {};
      pOrders.forEach(o => {
        if (o.seller && !mfrMap[o.seller.id]) mfrMap[o.seller.id] = o.seller;
      });
      const mfrs = Object.values(mfrMap);
      setLinkedManufacturers(mfrs);

      const shops = (partData.partners || []).filter(p => p.role === 'SHOP');
      setRetailOutlets(shops);

      setBadges({
        retailOrders: rOrders.filter(o => o.status === 'Pending').length,
        manufacturers: mfrs.length,
        outlets: shops.length,
        staff: 0
      });
    } catch (err) {
      console.error('Distributor dashboard load error:', err);
    }
  };

  useEffect(() => { refreshDashboard(); }, []);

  // ── Route → auto-open modal ───────────────────────────────────────────────
  useEffect(() => {
    if (pathname === '/distributor/order-mfr') setPoModalOpen(true);
    else if (pathname === '/distributor/add-own-product') setOwnProductModalOpen(true);
    else if (pathname === '/distributor/add-staff') setStaffModalOpen(true);
    else if (pathname === '/distributor/request-mfr') setRequestMfrModalOpen(true);
  }, [pathname]);

  const handleModalClose = () => {
    setPoModalOpen(false);
    setOwnProductModalOpen(false);
    setStaffModalOpen(false);
    setRequestMfrModalOpen(false);
    navigate('/distributor');
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleDispatch = async (orderId) => {
    try {
      await updateOrderStatus(orderId, 'Dispatched');
      await refreshDashboard();
    } catch (err) {
      console.error('Dispatch error:', err);
    }
  };

  const handleOwnProductSubmit = async (e) => {
    e.preventDefault();
    try {
      await createProduct({
        name: ownProductForm.name,
        sku: ownProductForm.sku,
        price: parseFloat(ownProductForm.sellingPrice) || 0,
        description: ownProductForm.description,
        stockLevel: parseInt(ownProductForm.stock) || 0,
        industryId: user.industryId
      });
      await refreshDashboard();
      handleModalClose();
      setOwnProductForm({ name: '', brand: '', category: '', sku: '', description: '', sellingPrice: '', mrp: '', stock: '', moq: '1' });
    } catch (err) {
      console.error('Create product error:', err);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const pendingRetailOrders = retailOrders.filter(o => o.status === 'Pending');
  const completedRetailOrders = retailOrders.filter(o => o.status === 'Delivered');
  const lowStockProducts = products.filter(p => (p.stockLevel ?? 0) <= 5);

  // ── Location chain ────────────────────────────────────────────────────────
  const locationChain = [
    user.stateName && { type: 'state', label: user.stateName },
    user.industry?.name && { type: 'ind', label: user.industry.name },
    user.districtName && { type: 'dist', label: user.districtName },
    { type: 'distributor', label: distName }
  ].filter(Boolean);

  // ── Column definitions ────────────────────────────────────────────────────
  const productColumns = [
    {
      header: '',
      render: () => (
        <div className="product-img">📦</div>
      )
    },
    {
      header: 'Product',
      render: (row) => (
        <div>
          <div style={{ fontWeight: '500' }}>{row.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>SKU: {row.sku || '—'}</div>
        </div>
      )
    },
    {
      header: 'Source',
      render: () => <Tag text="Own Stock" type="purple" />
    },
    {
      header: 'Category',
      render: (row) => (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {row.industry?.name || '—'}
        </span>
      )
    },
    {
      header: 'Your Price',
      render: (row) => (
        <span className="mono" style={{ textAlign: 'right' }}>
          ₹{(row.price || 0).toLocaleString('en-IN')}
        </span>
      )
    },
    {
      header: 'Stock',
      render: (row) => (
        <span className="mono" style={{ textAlign: 'right', color: (row.stockLevel ?? 0) < 10 ? 'var(--red)' : 'inherit' }}>
          {row.stockLevel ?? 0}
        </span>
      )
    },
    {
      header: 'Status',
      render: (row) => {
        const st = (row.stockLevel ?? 0) < 10 ? 'Low Stock' : 'Active';
        return <Tag text={st} type={st === 'Low Stock' ? 'red' : 'green'} />;
      }
    }
  ];

  const retailOrderColumns = [
    {
      header: 'Order ID',
      render: (row) => <span className="mono" style={{ color: 'var(--text-muted)' }}>#ORD-{row.id}</span>
    },
    {
      header: 'Shop',
      render: (row) => <div style={{ fontWeight: '500' }}>{row.buyer?.businessName || row.buyer?.name || '—'}</div>
    },
    {
      header: 'Items',
      render: (row) => <span className="mono">{row.items?.length || 0}</span>
    },
    {
      header: 'Address',
      render: (row) => (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {row.buyer?.districtName || row.buyer?.stateName || '—'}
        </span>
      )
    },
    {
      header: 'Amount',
      render: (row) => (
        <span className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
          {formatRupees(orderTotal(row))}
        </span>
      )
    },
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
      render: (row) =>
        row.status === 'Pending' ? (
          <button
            className="btn btn-outline"
            style={{ padding: '3px 9px', fontSize: '11px' }}
            onClick={() => handleDispatch(row.id)}
          >
            Dispatch
          </button>
        ) : null
    }
  ];

  const poColumns = [
    {
      header: 'PO ID',
      render: (row) => <span className="mono">#PO-{row.id}</span>
    },
    {
      header: 'Manufacturer',
      render: (row) => <div style={{ fontWeight: '500' }}>{row.seller?.businessName || row.seller?.name || '—'}</div>
    },
    {
      header: 'Items',
      render: (row) => <span className="mono">{row.items?.length || 0}</span>
    },
    {
      header: 'Order Date',
      render: (row) => (
        <span style={{ color: 'var(--text-muted)' }}>
          {row.createdAt ? new Date(row.createdAt).toLocaleDateString('en-IN') : '—'}
        </span>
      )
    },
    {
      header: 'Amount',
      render: (row) => (
        <span className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
          {formatRupees(orderTotal(row))}
        </span>
      )
    },
    {
      header: 'Status',
      render: (row) => (
        <Tag
          text={row.status}
          type={
            row.status === 'Processing' || row.status === 'Pending' ? 'amber'
              : row.status === 'Dispatched' ? 'blue'
              : 'green'
          }
        />
      )
    }
  ];

  const retailOutletColumns = [
    {
      header: 'Shop Name',
      render: (row) => <div style={{ fontWeight: '500' }}>{row.businessName || row.name}</div>
    },
    {
      header: 'Owner',
      render: (row) => <span>{row.name}</span>
    },
    {
      header: 'Category',
      render: (row) => <span>{row.industry?.name || '—'}</span>
    },
    {
      header: 'Orders (Mo)',
      render: () => <span className="mono" style={{ textAlign: 'right' }}>—</span>
    },
    {
      header: 'Outstanding',
      render: () => <span className="mono" style={{ textAlign: 'right' }}>₹0</span>
    },
    {
      header: 'Status',
      render: () => <Tag text="Active" type="green" />
    }
  ];

  // ── Sub-page rendering ────────────────────────────────────────────────────
  const renderContent = () => {
    switch (pathname) {

      // ── PRODUCTS PAGE ────────────────────────────────────────────────────
      case '/distributor/products':
        return (
          <>
            <div className="section-header">
              <div>
                <div className="section-title">All Products — {distName}</div>
                <div className="section-sub">{products.length} products from manufacturers + your own listings</div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/distributor/add-own-product')}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Add Own Product
              </button>
            </div>
            <div className="info-box">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="8" cy="8" r="6" stroke="#1E3A8A" strokeWidth="1.4" />
                <path d="M8 7v4" stroke="#1E3A8A" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>Products from your linked manufacturers are automatically available in your catalogue. You can also add your own products below.</span>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Product</th>
                      <th>Source</th>
                      <th className="hide-mobile">Category</th>
                      <th style={{ textAlign: 'right' }}>Your Price</th>
                      <th style={{ textAlign: 'right' }}>Stock</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id}>
                        <td><div className="product-img">📦</div></td>
                        <td>
                          <div style={{ fontWeight: '500' }}>{p.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>SKU: {p.sku || '—'}</div>
                        </td>
                        <td><Tag text="Own Stock" type="purple" /></td>
                        <td className="hide-mobile">
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.industry?.name || '—'}</span>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          ₹{(p.price || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: (p.stockLevel ?? 0) < 10 ? 'var(--red)' : 'inherit' }}>
                          {p.stockLevel ?? 0}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Tag
                            text={(p.stockLevel ?? 0) < 10 ? 'Low Stock' : 'Active'}
                            type={(p.stockLevel ?? 0) < 10 ? 'red' : 'green'}
                          />
                        </td>
                      </tr>
                    ))}
                    {products.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No products in catalog yet. Add your own products above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );

      // ── ORDERS: RETAIL ───────────────────────────────────────────────────
      case '/distributor/orders-retail':
        return (
          <>
            <div className="section-header">
              <div>
                <div className="section-title">Orders from Retail Outlets</div>
                <div className="section-sub">All orders from shops and retail outlets in your service area</div>
              </div>
              <div className="tabs">
                <div className="tab active">Pending ({pendingRetailOrders.length})</div>
                <div className="tab">Dispatched</div>
                <div className="tab">Delivered</div>
                <div className="tab">All</div>
              </div>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Shop</th>
                      <th className="hide-mobile">Items</th>
                      <th className="hide-mobile">Address</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retailOrders.map(o => (
                      <tr key={o.id}>
                        <td className="mono" style={{ color: 'var(--text-muted)' }}>#ORD-{o.id}</td>
                        <td><div style={{ fontWeight: '500' }}>{o.buyer?.businessName || o.buyer?.name || '—'}</div></td>
                        <td className="mono hide-mobile" style={{ textAlign: 'right' }}>{o.items?.length || 0}</td>
                        <td className="hide-mobile" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {o.buyer?.districtName || o.buyer?.stateName || '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
                          {formatRupees(orderTotal(o))}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Tag
                            text={o.status}
                            type={o.status === 'Pending' ? 'amber' : o.status === 'Dispatched' ? 'blue' : 'green'}
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {o.status === 'Pending' && (
                            <button
                              className="btn btn-outline"
                              style={{ padding: '3px 9px', fontSize: '11px' }}
                              onClick={() => handleDispatch(o.id)}
                            >
                              Dispatch
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {retailOrders.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No retail orders yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );

      // ── ORDERS: TO MANUFACTURERS ─────────────────────────────────────────
      case '/distributor/orders-to-manufacturers':
        return (
          <>
            <div className="section-header">
              <div>
                <div className="section-title">Orders to Manufacturers</div>
                <div className="section-sub">Your purchase orders to manufacturers</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/distributor/order-mfr')}>
                + New Order
              </button>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>PO ID</th>
                      <th>Manufacturer</th>
                      <th className="hide-mobile">Items</th>
                      <th className="hide-mobile">Order Date</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.map(o => (
                      <tr key={o.id}>
                        <td className="mono">#PO-{o.id}</td>
                        <td><div style={{ fontWeight: '500' }}>{o.seller?.businessName || o.seller?.name || '—'}</div></td>
                        <td className="mono hide-mobile">{o.items?.length || 0}</td>
                        <td className="hide-mobile" style={{ color: 'var(--text-muted)' }}>
                          {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
                          {formatRupees(orderTotal(o))}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Tag
                            text={o.status}
                            type={
                              o.status === 'Processing' || o.status === 'Pending' ? 'amber'
                                : o.status === 'Dispatched' ? 'blue'
                                : 'green'
                            }
                          />
                        </td>
                      </tr>
                    ))}
                    {purchaseOrders.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No purchase orders placed yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );

      // ── MANUFACTURERS ────────────────────────────────────────────────────
      case '/distributor/manufacturers':
        return (
          <>
            <div className="section-header">
              <div>
                <div className="section-title">My Manufacturers</div>
                <div className="section-sub">Manufacturers whose products you are authorized to distribute</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/distributor/request-mfr')}>
                Request Manufacturer
              </button>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Manufacturer</th>
                      <th className="hide-mobile">Category</th>
                      <th className="hide-mobile">Products</th>
                      <th className="hide-mobile">Last Order</th>
                      <th style={{ textAlign: 'right' }}>Total Orders</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedManufacturers.map(m => (
                      <tr key={m.id}>
                        <td>
                          <div style={{ fontWeight: '500' }}>{m.businessName || m.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {m.industryId ? `Industry #${m.industryId}` : '—'}
                          </div>
                        </td>
                        <td className="hide-mobile">{m.industry?.name || '—'}</td>
                        <td className="mono hide-mobile">—</td>
                        <td className="hide-mobile" style={{ color: 'var(--text-muted)' }}>
                          {purchaseOrders
                            .filter(o => o.seller?.id === m.id)
                            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]?.createdAt
                            ? new Date(purchaseOrders
                              .filter(o => o.seller?.id === m.id)
                              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].createdAt
                            ).toLocaleDateString('en-IN')
                            : '—'
                          }
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
                          {formatRupees(
                            purchaseOrders
                              .filter(o => o.seller?.id === m.id)
                              .reduce((s, o) => s + orderTotal(o), 0)
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Tag text="Active" type="green" />
                        </td>
                      </tr>
                    ))}
                    {linkedManufacturers.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No manufacturers linked yet. Place a purchase order to link a manufacturer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );

      // ── RETAIL OUTLETS ───────────────────────────────────────────────────
      case '/distributor/outlets':
        return (
          <>
            <div className="section-header">
              <div>
                <div className="section-title">Retail Outlets — {user.districtName || 'Your District'}</div>
                <div className="section-sub">All {retailOutlets.length} shops you serve as their primary distributor</div>
              </div>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Shop Name</th>
                      <th className="hide-mobile">Owner</th>
                      <th className="hide-mobile">Category</th>
                      <th style={{ textAlign: 'right' }}>Orders (Mo)</th>
                      <th style={{ textAlign: 'right' }}>Outstanding</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retailOutlets.map(s => (
                      <tr key={s.id}>
                        <td><div style={{ fontWeight: '500' }}>{s.businessName || s.name}</div></td>
                        <td className="hide-mobile">{s.name}</td>
                        <td className="hide-mobile">{s.industry?.name || '—'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>—</td>
                        <td className="mono" style={{ textAlign: 'right' }}>₹0</td>
                        <td style={{ textAlign: 'right' }}>
                          <Tag text="Active" type="green" />
                        </td>
                      </tr>
                    ))}
                    {retailOutlets.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No retail outlets in your service area yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );

      // ── FIELD STAFF ──────────────────────────────────────────────────────
      case '/distributor/staff':
        return (
          <>
            <div className="section-header">
              <div>
                <div className="section-title">Field Staff — {distName}</div>
                <div className="section-sub">Delivery agents and field officers in your team</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/distributor/add-staff')}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Add Staff
              </button>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th className="hide-mobile">Vehicle</th>
                      <th className="hide-mobile">Assigned Area</th>
                      <th style={{ textAlign: 'right' }}>Deliveries (Mo)</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                        No field staff added yet.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );

      // ── OVERVIEW (default) ───────────────────────────────────────────────
      default:
        return (
          <>
            {/* Stat row 1 */}
            <div className="stat-grid">
              <StatCard
                label="Total Sales (Retail)"
                value={formatRupees(stats.totalPurchased)}
                delta="This month"
                isUp={true}
                color="blue"
              />
              <StatCard
                label="Orders Fulfilled"
                value={String(completedRetailOrders.length)}
                delta="Delivered to shops"
                isUp={true}
                color="green"
              />
              <StatCard
                label="Pending Orders"
                value={String(stats.pendingShipments ?? pendingRetailOrders.length)}
                delta="⚠ Awaiting dispatch"
                isUp={false}
                color="amber"
              />
              <StatCard
                label="Retail Outlets Served"
                value={String(stats.mappedShops ?? retailOutlets.length)}
                delta={user.districtName ? `${user.districtName} region` : 'Your region'}
                isUp={true}
                color="teal"
              />
            </div>

            {/* Stat row 2 */}
            <div className="stat-grid">
              <StatCard
                label="Products (Total)"
                value={String(stats.warehouseProducts ?? products.length)}
                delta="From manufacturers + own"
                isUp={true}
                color="purple"
              />
              <StatCard
                label="Low Stock Items"
                value={String(lowStockProducts.length)}
                delta="⚠ Need restock"
                isUp={false}
                color="red"
              />
              <StatCard
                label="Field Staff"
                value="0"
                delta="Active delivery agents"
                isUp={true}
                color="blue"
              />
              <StatCard
                label="Revenue This Year"
                value={formatRupees(stats.totalPurchased)}
                delta=""
                isUp={true}
                color="green"
              />
            </div>

            {/* Two-col: manufacturers card + pending orders table */}
            <div className="two-col">
              {/* My Manufacturers */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="section-title" style={{ fontSize: '13px' }}>My Manufacturers</div>
                    <div className="section-sub" style={{ fontSize: '11px' }}>Products supplied to your warehouse</div>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => navigate('/distributor/request-mfr')}>
                    + Request Manufacturer
                  </button>
                </div>
                <div className="card-body" style={{ paddingTop: '12px' }}>
                  {linkedManufacturers.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      No manufacturers linked yet.
                    </div>
                  ) : (
                    linkedManufacturers.map(m => (
                      <div key={m.id} className="mfr-card">
                        <div className="mfr-logo" style={{ background: 'var(--brand-light)', color: 'var(--brand)', fontWeight: '600', fontSize: '13px' }}>
                          {initials(m.businessName || m.name)}
                        </div>
                        <div className="mfr-info">
                          <div className="mfr-name">{m.businessName || m.name}</div>
                          <div className="mfr-meta">{m.industry?.name || '—'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="mfr-stat" style={{ color: 'var(--accent)' }}>
                            {formatRupees(
                              purchaseOrders
                                .filter(o => o.seller?.id === m.id)
                                .reduce((s, o) => s + orderTotal(o), 0)
                            )}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>orders this mo</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div style={{ marginTop: '12px', textAlign: 'center' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => navigate('/distributor/manufacturers')}>
                      View All Manufacturers →
                    </button>
                  </div>
                </div>
              </div>

              {/* Pending Retail Orders */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="section-title" style={{ fontSize: '13px' }}>Pending Retail Orders</div>
                  </div>
                  <span style={{
                    background: 'var(--amber-light)', color: 'var(--amber)',
                    fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px'
                  }}>
                    {pendingRetailOrders.length} Pending
                  </span>
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Shop</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingRetailOrders.slice(0, 5).map(o => (
                          <tr key={o.id}>
                            <td className="mono" style={{ color: 'var(--text-muted)' }}>#ORD-{o.id}</td>
                            <td>
                              <div style={{ fontWeight: '500', fontSize: '12.5px' }}>
                                {o.buyer?.businessName || o.buyer?.name || '—'}
                              </div>
                            </td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
                              {formatRupees(orderTotal(o))}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className="btn btn-outline"
                                style={{ padding: '3px 9px', fontSize: '11px' }}
                                onClick={() => handleDispatch(o.id)}
                              >
                                Dispatch
                              </button>
                            </td>
                          </tr>
                        ))}
                        {pendingRetailOrders.length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                              No pending orders
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => navigate('/distributor/orders-retail')}>
                      View All {retailOrders.length} Orders →
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Low Stock Alert */}
            <div className="section-header">
              <div>
                <div className="section-title">Low Stock Alert</div>
                <div className="section-sub">Products needing reorder from manufacturers</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/distributor/order-mfr')}>
                Order Stock Now
              </button>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Product</th>
                      <th>Manufacturer</th>
                      <th className="hide-mobile">Category</th>
                      <th style={{ textAlign: 'right' }}>Current Stock</th>
                      <th style={{ textAlign: 'right' }}>Reorder Level</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockProducts.map(p => (
                      <tr key={p.id}>
                        <td>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: '8px',
                            background: 'var(--red-light)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontSize: '12px'
                          }}>⚠</div>
                        </td>
                        <td><div style={{ fontWeight: '500' }}>{p.name}</div></td>
                        <td><span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Own Stock</span></td>
                        <td className="hide-mobile">
                          <Tag text={p.industry?.name || '—'} type="purple" />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                            <div className="stock-bar-wrap" style={{ width: '60px' }}>
                              <div
                                className="stock-bar"
                                style={{
                                  width: `${Math.min(100, ((p.stockLevel ?? 0) / 20) * 100)}%`,
                                  background: 'var(--red)'
                                }}
                              />
                            </div>
                            <span className="mono" style={{ color: 'var(--red)' }}>{p.stockLevel ?? 0}</span>
                          </div>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>10</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => navigate('/distributor/order-mfr')}>
                            Reorder
                          </button>
                        </td>
                      </tr>
                    ))}
                    {lowStockProducts.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          All stock levels are healthy.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top Selling Products */}
            <div className="section-header">
              <div>
                <div className="section-title">Top Selling Products</div>
                <div className="section-sub">Your best performers from retail outlet orders this month</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/distributor/products')}>
                View All {products.length} →
              </button>
            </div>
            <div className="card full-col">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Product</th>
                      <th className="hide-mobile">Manufacturer</th>
                      <th className="hide-mobile">Category</th>
                      <th style={{ textAlign: 'right' }}>Sold (Mo)</th>
                      <th style={{ textAlign: 'right' }}>Revenue</th>
                      <th style={{ textAlign: 'right' }}>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 5).map(p => (
                      <tr key={p.id}>
                        <td><div className="product-img">📦</div></td>
                        <td><div style={{ fontWeight: '500' }}>{p.name}</div></td>
                        <td className="hide-mobile" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Own</td>
                        <td className="hide-mobile">
                          <Tag text={p.industry?.name || '—'} type="blue" />
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>—</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>—</td>
                        <td className="mono" style={{ textAlign: 'right', color: (p.stockLevel ?? 0) < 10 ? 'var(--red)' : 'inherit' }}>
                          {p.stockLevel ?? 0}
                        </td>
                      </tr>
                    ))}
                    {products.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No products in catalog yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout
      role="DISTRIBUTOR"
      badges={badges}
      title={`Distributor Dashboard — 📦 ${distName}`}
      subtitle="Products, retail orders, manufacturer stock and field team — all in one place"
      locationChain={locationChain}
      actionButton={
        <button className="btn btn-primary" onClick={() => navigate('/distributor/order-mfr')}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="6" width="12" height="8" rx="1.5" stroke="white" strokeWidth="1.4" />
            <path d="M5 6V4a3 3 0 016 0v2" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Order from Manufacturer
        </button>
      }
    >
      <div className="content">
        {renderContent()}
      </div>

      {/* ── MODAL: ORDER STOCK FROM MANUFACTURER ── */}
      <Modal
        isOpen={poModalOpen}
        onClose={handleModalClose}
        title="Order Stock from Manufacturer"
        subtitle="Place a purchase order to restock your warehouse"
        width="800px"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleModalClose}>Place Purchase Order</button>
          </>
        }
      >
        <div className="form-section-title">Select Manufacturer</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '18px' }}>
          {[0, 1, 2].map(i => {
            const labels = ['Manufacturer A', 'Manufacturer B', 'Manufacturer C'];
            const icons = ['🏭', '🏗️', '🏢'];
            const mfr = linkedManufacturers[i];
            return (
              <div
                key={i}
                onClick={() => setPoSelectedMfr(i)}
                style={{
                  border: poSelectedMfr === i ? '2px solid var(--brand)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '12px',
                  cursor: 'pointer',
                  background: poSelectedMfr === i ? 'var(--brand-light)' : '',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '20px', marginBottom: '4px' }}>{icons[i]}</div>
                <div style={{
                  fontSize: '12px', fontWeight: '600',
                  color: poSelectedMfr === i ? 'var(--brand)' : 'var(--text-secondary)'
                }}>
                  {mfr ? (mfr.businessName || mfr.name) : labels[i]}
                </div>
              </div>
            );
          })}
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Select Products &amp; Quantities</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: '10px',
            padding: '8px 14px', background: 'var(--surface2)', fontSize: '11px',
            fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase',
            letterSpacing: '.05em', borderBottom: '1px solid var(--border)'
          }}>
            <div>Product</div>
            <div style={{ textAlign: 'right' }}>Unit Price</div>
            <div style={{ textAlign: 'right' }}>Qty</div>
          </div>
          {poItems.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: '10px',
                padding: '10px 14px',
                borderBottom: idx < poItems.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: '500' }}>{item.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>SKU: {item.sku}</div>
              </div>
              <div className="mono" style={{ textAlign: 'right', fontSize: '12px' }}>
                ₹{item.price.toLocaleString('en-IN')}
              </div>
              <input
                type="number"
                value={item.qty}
                min="1"
                onChange={(e) => handlePoQtyChange(item.id, e.target.value)}
                style={{
                  padding: '5px 8px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', fontFamily: 'DM Mono, monospace',
                  fontSize: '13px', textAlign: 'right', width: '100%', outline: 'none'
                }}
              />
            </div>
          ))}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'flex-end', padding: '10px 14px',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderTop: 'none', borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
          gap: '16px', fontSize: '13px'
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Subtotal:</span>
          <span className="mono" style={{ fontWeight: '600', fontSize: '15px', color: 'var(--brand)' }}>
            ₹{calcPoTotal().toLocaleString('en-IN')}
          </span>
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Delivery Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Deliver to</label>
            <input
              className="form-input"
              value={`${user.districtName || 'Your District'} Warehouse`}
              readOnly
              style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}
            />
          </div>
          <div>
            <label className="form-label">Required By Date</label>
            <input
              type="date"
              className="form-input"
              value={poRequiredDate}
              onChange={e => setPoRequiredDate(e.target.value)}
            />
          </div>
        </div>
        <div className="form-full">
          <label className="form-label">Special Instructions</label>
          <textarea
            className="form-input"
            rows="2"
            placeholder="Any delivery notes or packing instructions…"
            style={{ resize: 'vertical' }}
            value={poInstructions}
            onChange={e => setPoInstructions(e.target.value)}
          />
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Payment</div>
        <div className="form-full">
          <select className="form-select" value={poPayment} onChange={e => setPoPayment(e.target.value)}>
            <option value="Credit (Net 30 days)">Credit (Net 30 days)</option>
            <option value="Advance Payment">Advance Payment</option>
            <option value="COD on Delivery">COD on Delivery</option>
            <option value="Bank Transfer">Bank Transfer</option>
          </select>
        </div>
      </Modal>

      {/* ── MODAL: ADD OWN PRODUCT ── */}
      <Modal
        isOpen={ownProductModalOpen}
        onClose={handleModalClose}
        title="Add Own Product"
        subtitle="List your own stocked product — separate from manufacturer products"
        width="700px"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleOwnProductSubmit}>Publish Product</button>
          </>
        }
      >
        <div className="info-box">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="8" cy="8" r="6" stroke="#1E3A8A" strokeWidth="1.4" />
            <path d="M8 7v4" stroke="#1E3A8A" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>Own products are items you stock independently — not from your linked manufacturers. These are visible to retail outlets in your service area on the Partner App.</span>
        </div>

        <div className="form-section-title">Product Information</div>
        <div className="form-row">
          <div>
            <label className="form-label">Product Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Generic Brake Pad Set"
              required
              value={ownProductForm.name}
              onChange={e => setOwnProductForm({ ...ownProductForm, name: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Brand / Make</label>
            <input
              type="text"
              className="form-input"
              placeholder="Brand name"
              value={ownProductForm.brand}
              onChange={e => setOwnProductForm({ ...ownProductForm, brand: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Category <span style={{ color: 'var(--red)' }}>*</span></label>
            <select
              className="form-select"
              required
              value={ownProductForm.category}
              onChange={e => setOwnProductForm({ ...ownProductForm, category: e.target.value })}
            >
              <option value="">Select Category</option>
              <option value="Auto Parts & Spares">Auto Parts &amp; Spares</option>
              <option value="Tyres & Tubes">Tyres &amp; Tubes</option>
              <option value="Accessories">Accessories</option>
              <option value="Lubricants & Fluids">Lubricants &amp; Fluids</option>
              <option value="Electrical Components">Electrical Components</option>
              <option value="Tools & Equipment">Tools &amp; Equipment</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">SKU / Item Code</label>
            <input
              type="text"
              className="form-input"
              placeholder="Your internal code"
              value={ownProductForm.sku}
              onChange={e => setOwnProductForm({ ...ownProductForm, sku: e.target.value })}
            />
          </div>
        </div>
        <div className="form-full">
          <label className="form-label">Description</label>
          <textarea
            className="form-input"
            rows="2"
            placeholder="Product description, compatibility, specs…"
            style={{ resize: 'vertical' }}
            value={ownProductForm.description}
            onChange={e => setOwnProductForm({ ...ownProductForm, description: e.target.value })}
          />
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Pricing &amp; Stock</div>
        <div className="form-row">
          <div>
            <label className="form-label">Selling Price (₹) <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="number"
              className="form-input"
              placeholder="Price to retail outlets"
              required
              value={ownProductForm.sellingPrice}
              onChange={e => setOwnProductForm({ ...ownProductForm, sellingPrice: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">MRP (₹)</label>
            <input
              type="number"
              className="form-input"
              placeholder="Maximum retail price"
              value={ownProductForm.mrp}
              onChange={e => setOwnProductForm({ ...ownProductForm, mrp: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Current Stock <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="number"
              className="form-input"
              placeholder="Units in stock"
              required
              value={ownProductForm.stock}
              onChange={e => setOwnProductForm({ ...ownProductForm, stock: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Minimum Order Qty</label>
            <input
              type="number"
              className="form-input"
              placeholder="Min per order"
              value={ownProductForm.moq}
              onChange={e => setOwnProductForm({ ...ownProductForm, moq: e.target.value })}
            />
          </div>
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Product Images</div>
        <div className="upload-zone">
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>📷</div>
          <div style={{ fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            Click to upload product images
          </div>
          <div style={{ fontSize: '12px' }}>PNG, JPG up to 5MB each · Max 4 images</div>
        </div>
      </Modal>

      {/* ── MODAL: REQUEST MANUFACTURER ── */}
      <Modal
        isOpen={requestMfrModalOpen}
        onClose={handleModalClose}
        title="Request Manufacturer Link"
        subtitle="Apply to distribute products from a manufacturer on RoadMate"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleModalClose}>Send Request</button>
          </>
        }
      >
        <div className="info-box">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="8" cy="8" r="6" stroke="#1E3A8A" strokeWidth="1.4" />
            <path d="M8 7v4" stroke="#1E3A8A" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>Your request will be sent to the manufacturer. Once they approve, their products will appear in your catalogue and you can begin placing purchase orders.</span>
        </div>

        <div className="form-full">
          <label className="form-label">Select Manufacturer <span style={{ color: 'var(--red)' }}>*</span></label>
          <select className="form-select">
            <option value="">Choose a manufacturer</option>
            <option>Maruti Suzuki India</option>
            <option>TVS Motor Company</option>
            <option>Bajaj Auto</option>
            <option>MRF Tyres</option>
            <option>Bosch India</option>
            <option>CEAT Tyres</option>
            <option>Mahindra &amp; Mahindra</option>
          </select>
        </div>
        <div className="form-full">
          <label className="form-label">Products Interested In <span style={{ color: 'var(--red)' }}>*</span></label>
          <input type="text" className="form-input" placeholder="e.g. Two Wheeler Spare Parts, Engine Components" />
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Expected Monthly Volume</label>
            <input type="text" className="form-input" placeholder="e.g. ₹2-5 Lakh/month" />
          </div>
          <div>
            <label className="form-label">Storage Capacity</label>
            <select className="form-select">
              <option>Small (up to 500 sq ft)</option>
              <option>Medium (500-2000 sq ft)</option>
              <option>Large (2000+ sq ft)</option>
            </select>
          </div>
        </div>
        <div className="form-full">
          <label className="form-label">Business Note</label>
          <textarea
            className="form-input"
            rows="3"
            placeholder="Tell the manufacturer about your business, reach, existing clients…"
            style={{ resize: 'vertical' }}
          />
        </div>
      </Modal>

      {/* ── MODAL: ADD FIELD STAFF ── */}
      <Modal
        isOpen={staffModalOpen}
        onClose={handleModalClose}
        title="Add Field Staff"
        subtitle="Create a delivery agent or field officer profile"
        width="700px"
        footer={
          <>
            <button className="btn btn-outline" onClick={handleModalClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleModalClose}>Create Staff Profile</button>
          </>
        }
      >
        <div className="form-section-title">Role</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          <div style={{
            border: '2px solid var(--brand)', borderRadius: 'var(--radius)', padding: '12px',
            cursor: 'pointer', background: 'var(--brand-light)', textAlign: 'center'
          }}>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>🚚</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--brand)' }}>Delivery Agent</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Picks up and delivers orders to shops</div>
          </div>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px',
            cursor: 'pointer', textAlign: 'center'
          }}>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>📋</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Field Officer</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Visits shops, takes orders, collects payments</div>
          </div>
        </div>

        <div className="form-section-title">Personal Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Full Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="Staff member's name" />
          </div>
          <div>
            <label className="form-label">Mobile Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="tel" className="form-input" placeholder="+91 XXXXX XXXXX" />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">Aadhaar Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="XXXX XXXX XXXX" maxLength={14} />
            <div style={{ marginTop: '6px' }}>
              <div style={{
                border: '1.5px dashed var(--border2)', borderRadius: 'var(--radius-sm)',
                padding: '8px 12px', cursor: 'pointer', background: 'var(--surface2)',
                display: 'flex', alignItems: 'center', gap: '8px',
                fontSize: '12.5px', color: 'var(--text-muted)'
              }}>
                <span>🪪</span><span>Upload Aadhaar</span>
              </div>
            </div>
          </div>
          <div>
            <label className="form-label">Vehicle Type</label>
            <select className="form-select">
              <option value="">Select Vehicle</option>
              <option>🛵 Two Wheeler (Own)</option>
              <option>🚗 Four Wheeler (Own)</option>
              <option>🚐 Company Vehicle</option>
              <option>No Vehicle</option>
            </select>
          </div>
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Assignment &amp; Pay</div>
        <div className="form-row">
          <div>
            <label className="form-label">Assigned Area</label>
            <input type="text" className="form-input" placeholder={`e.g. ${user.districtName || 'Your District'} (North Zone)`} />
          </div>
          <div>
            <label className="form-label">Monthly Pay</label>
            <select className="form-select">
              <option>₹10,000/month</option>
              <option>₹12,000/month</option>
              <option>₹15,000/month</option>
              <option>Per Delivery Basis</option>
            </select>
          </div>
        </div>

        <div className="form-divider" />

        <div className="form-section-title">Bank Details</div>
        <div className="form-row">
          <div>
            <label className="form-label">Bank Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="form-select">
              <option value="">Select Bank</option>
              <option>State Bank of India</option>
              <option>HDFC Bank</option>
              <option>ICICI Bank</option>
              <option>Axis Bank</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Account Number <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="Account number" />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="form-label">IFSC Code <span style={{ color: 'var(--red)' }}>*</span></label>
            <input type="text" className="form-input" placeholder="SBIN0001234" />
          </div>
          <div>
            <label className="form-label">UPI ID</label>
            <input type="text" className="form-input" placeholder="name@upi (optional)" />
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
};

export default DistributorDashboard;
