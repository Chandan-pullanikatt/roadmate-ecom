import axios from 'axios';

// Preconfigure Axios instance with base backend API url
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Interceptor to automatically append the JWT token from localStorage
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('roadmate_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Auth endpoints
export const loginUser = async (email, password) => {
  const response = await api.post('/auth/login', { email, password });
  if (response.data.token) {
    localStorage.setItem('roadmate_token', response.data.token);
    localStorage.setItem('roadmate_role', response.data.user.role);
    localStorage.setItem('roadmate_user', JSON.stringify(response.data.user));
  }
  return response.data;
};

export const logoutUser = () => {
  localStorage.removeItem('roadmate_token');
  localStorage.removeItem('roadmate_role');
  localStorage.removeItem('roadmate_user');
  window.location.hash = '#/';
};

// Analytics Dashboard Overview Metrics
export const getOverviewStats = async (period) => {
  const response = await api.get('/dashboard/overview', { params: period ? { period } : {} });
  return response.data;
};

// Partner Onboarding & Approvals
export const createPartner = async (partnerData) => {
  const response = await api.post('/partners/create', partnerData);
  return response.data;
};

export const getPendingApprovals = async () => {
  const response = await api.get('/partners/pending');
  return response.data;
};

export const getActivePartners = async () => {
  const response = await api.get('/partners/active');
  return response.data;
};

export const approvePartner = async (id) => {
  const response = await api.post(`/partners/${id}/approve`);
  return response.data;
};

export const rejectPartner = async (id) => {
  const response = await api.post(`/partners/${id}/reject`);
  return response.data;
};

// Where a shop is. A shop with no coordinates is not merely unranked — it is
// invisible to every customer, so this is the repair route for the shops
// onboarded before the field existed.
export const setPartnerLocation = async (id, location) => {
  const response = await api.patch(`/partners/${id}/location`, location);
  return response.data;
};

// Expenses ledger
export const getExpenses = async () => {
  const response = await api.get('/expenses');
  return response.data;
};

export const createExpense = async (expenseData) => {
  const response = await api.post('/expenses/create', expenseData);
  return response.data;
};

// Products catalog
export const getProducts = async (params = {}) => {
  const response = await api.get('/products', { params });
  return response.data;
};

// Coupons (PHASE A.3). MASTER only. ⚠️ `deleteCoupon` answers 409
// COUPON_IN_USE for a coupon any order has claimed — that row is the recorded
// reason a delivered order was discounted, so withdrawing it is `isActive:
// false`, never a delete.
export const getCoupons = async () => {
  const response = await api.get('/master/coupons');
  return response.data;
};

export const createCoupon = async (coupon) => {
  const response = await api.post('/master/coupons', coupon);
  return response.data;
};

export const updateCoupon = async (id, coupon) => {
  const response = await api.patch(`/master/coupons/${id}`, coupon);
  return response.data;
};

export const deleteCoupon = async (id) => {
  const response = await api.delete(`/master/coupons/${id}`);
  return response.data;
};

// Merchandising (PHASE B). Banners carry a validity window so a festival strip
// switches itself off; collections are curated ordered lists with no money in
// them anywhere. MASTER only.
export const getBanners = async () => {
  const response = await api.get('/master/banners');
  return response.data;
};

export const createBanner = async (banner) => {
  const response = await api.post('/master/banners', banner);
  return response.data;
};

export const updateBanner = async (id, banner) => {
  const response = await api.patch(`/master/banners/${id}`, banner);
  return response.data;
};

export const deleteBanner = async (id) => {
  const response = await api.delete(`/master/banners/${id}`);
  return response.data;
};

export const signBannerImageUpload = async () => {
  const response = await api.post('/master/banners/uploads/signature', { kind: 'BANNER_IMAGE' });
  return response.data;
};

export const getCollections = async () => {
  const response = await api.get('/master/collections');
  return response.data;
};

export const createCollection = async (collection) => {
  const response = await api.post('/master/collections', collection);
  return response.data;
};

export const updateCollection = async (id, collection) => {
  const response = await api.patch(`/master/collections/${id}`, collection);
  return response.data;
};

export const deleteCollection = async (id) => {
  const response = await api.delete(`/master/collections/${id}`);
  return response.data;
};

// The whole list, in order — order *is* the content, so it is replaced as one
// write rather than through add/remove/reorder verbs that can half-fail.
export const setCollectionItems = async (id, productIds) => {
  const response = await api.put(`/master/collections/${id}/items`, { productIds });
  return response.data;
};

// A one-shot authorisation to upload one catalogue photo. The browser posts the
// bytes straight to Cloudinary with this signature attached — they never transit
// our API, and the API secret never leaves the server (`lib/cloudinary.js`).
export const signProductImageUpload = async () => {
  const response = await api.post('/products/uploads/signature', { kind: 'PRODUCT_IMAGE' });
  return response.data;
};

export const createProduct = async (productData) => {
  const response = await api.post('/products/create', productData);
  return response.data;
};

export const updateProduct = async (id, productData) => {
  const response = await api.put(`/products/${id}`, productData);
  return response.data;
};

export const deleteProduct = async (id) => {
  const response = await api.delete(`/products/${id}`);
  return response.data;
};

// B2B Procurement Orders
export const getOrders = async () => {
  const response = await api.get('/orders');
  return response.data;
};

export const createOrder = async (orderData) => {
  const response = await api.post('/orders/create', orderData);
  return response.data;
};

export const updateOrderStatus = async (id, status) => {
  const response = await api.put(`/orders/${id}/status`, { status });
  return response.data;
};

export const getPayouts = async () => {
  const response = await api.get('/payouts');
  return response.data;
};

// Industries list (for form dropdowns)
export const getIndustries = async () => {
  const response = await api.get('/industries');
  return response.data;
};

// District: revenue summary rows + totals
export const getDistrictRevenue = async (period) => {
  const response = await api.get('/district/revenue', { params: period ? { period } : {} });
  return response.data;
};

// District: per-category revenue drill-down (regions | shops | delivery | distributors)
export const getDistrictRevenueDetail = async (category, period) => {
  const response = await api.get(`/district/revenue/${category}`, { params: period ? { period } : {} });
  return response.data;
};

// Master: aggregated states overview
export const getMasterStatesOverview = async () => {
  const response = await api.get('/master/states');
  return response.data;
};

// Master: aggregated districts overview
export const getMasterDistrictsOverview = async () => {
  const response = await api.get('/master/districts');
  return response.data;
};

/* ── Master: platform settings (PlatformConfig) ───────────────────────────────
 * Every tunable number on the platform — commission, tax per industry, delivery
 * fee, rider pay, subscription fees, the accept window. MASTER only; before
 * these existed each one needed a developer running a script.
 */
export const getPlatformConfig = async () => {
  const response = await api.get('/master/config');
  return response.data;
};

// `updates` is [{ key, value, industryId? }]. A blank value CLEARS the row —
// which is not the same as 0: unset means nobody has decided, 0 means free.
export const savePlatformConfig = async (updates) => {
  const response = await api.put('/master/config', { updates });
  return response.data;
};

// Falls a key back to what is behind it: an industry override to the global
// row, the global row to the code's documented default.
export const clearPlatformConfig = async (key, industryId) => {
  const response = await api.delete(`/master/config/${key}`, {
    params: industryId ? { industryId } : {}
  });
  return response.data;
};

/* ── Partner subscriptions (HANDOFF §7ter) ─────────────────────────────────
 * The three billable roles (shop, distributor, manufacturer), their free
 * trials, and every invoice raised against them. MASTER only.
 *
 * Money here is a fixed-2 **string**, not a number — subscriptions are Decimal
 * on the server like the rest of the B2C money. Format it, never parseFloat it.
 */
export const getBillingOverview = async () => {
  const response = await api.get('/master/billing');
  return response.data;
};

// A bank transfer, cheque or cash the accounts team reconciled. `reference` is
// required: a payment nobody can match to a bank statement is not a record.
export const markInvoicePaid = async (invoiceId, reference) => {
  const response = await api.post(`/master/billing/invoices/${invoiceId}/mark-paid`, { reference });
  return response.data;
};

// Written off or billed in error. Only an unpaid invoice can be voided — a paid
// one would be a refund, and there is deliberately no refund flow here.
export const voidInvoice = async (invoiceId, note) => {
  const response = await api.post(`/master/billing/invoices/${invoiceId}/void`, { note });
  return response.data;
};

// Stops future invoices. Anything already issued stays owed.
export const cancelPartnerSubscription = async (userId, note) => {
  const response = await api.post(`/master/billing/partners/${userId}/cancel`, { note });
  return response.data;
};
