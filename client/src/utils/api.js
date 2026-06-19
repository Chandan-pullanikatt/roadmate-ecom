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
export const getOverviewStats = async () => {
  const response = await api.get('/dashboard/overview');
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
export const getDistrictRevenue = async () => {
  const response = await api.get('/district/revenue');
  return response.data;
};

// District: per-category revenue drill-down (regions | shops | delivery | distributors)
export const getDistrictRevenueDetail = async (category) => {
  const response = await api.get(`/district/revenue/${category}`);
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
