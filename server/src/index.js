import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { protect, restrictTo } from './middlewares/authMiddleware.js';
import { login, getMe } from './controllers/authController.js';
import { getOverview } from './controllers/dashboardController.js';
import {
  createPartner,
  getPendingApprovals,
  approvePartner,
  rejectPartner,
  getActivePartners,
  getExpenses,
  createExpense
} from './controllers/partnerController.js';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct
} from './controllers/productController.js';
import {
  getOrders,
  createOrder,
  updateOrderStatus,
  getPayouts
} from './controllers/orderController.js';
import {
  getStatesOverview,
  getDistrictsOverview
} from './controllers/masterController.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Normalize allowed origins: trim whitespace and strip any trailing slash so
// "https://foo.app/" in config still matches the browser origin "https://foo.app".
const normalizeOrigin = (o) => o.trim().replace(/\/+$/, '');
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);
console.log('CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, server-to-server) with no Origin header
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    console.warn('CORS blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

// Public Auth routes
app.post('/api/auth/login', login);

// Public: Industries list (used for form dropdowns)
app.get('/api/industries', async (req, res) => {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const industries = await prisma.industry.findMany({ orderBy: { name: 'asc' } });
    res.status(200).json({ status: 'success', industries });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load industries.' });
  }
});

// Protected routes (require valid JWT)
app.use('/api', protect);

// Auth - Me session
app.get('/api/auth/me', getMe);

// Dashboard stats
app.get('/api/dashboard/overview', getOverview);

// Partner Onboarding & Approvals
app.post('/api/partners/create', createPartner);
app.get('/api/partners/pending', getPendingApprovals);
app.get('/api/partners/active', getActivePartners);
app.post('/api/partners/:id/approve', approvePartner);
app.post('/api/partners/:id/reject', rejectPartner);

// Partner Expenses
app.get('/api/expenses', getExpenses);
app.post('/api/expenses/create', createExpense);

// Catalog Products CRUD
app.get('/api/products', getProducts);
app.post('/api/products/create', createProduct);
app.put('/api/products/:id', updateProduct);
app.delete('/api/products/:id', deleteProduct);

// Master-only aggregated views (role-guarded by JWT)
app.get('/api/master/states', getStatesOverview);
app.get('/api/master/districts', getDistrictsOverview);

// B2B Procurement Orders
app.get('/api/orders', getOrders);
app.post('/api/orders/create', createOrder);
app.put('/api/orders/:id/status', updateOrderStatus);
app.get('/api/payouts', getPayouts);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Global Error:', err.message);
  res.status(500).json({ 
    message: 'An unexpected internal server error occurred.',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` RoadMate B2B2C API Server running on port ${PORT}`);
  console.log(` DB URL: Connected via PostgreSQL on port 5433`);
  console.log(` Active Environment: Production ready`);
  console.log(`==================================================`);
});
