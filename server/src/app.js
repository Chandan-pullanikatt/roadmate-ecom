// Express app, with no port binding — `index.js` starts the server, tests mount
// this directly via supertest.
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import prisma from './lib/prisma.js';
import { protect, restrictTo } from './middlewares/authMiddleware.js';
import { protectCustomer } from './middlewares/customerAuthMiddleware.js';
import { login, getMe, requestStaffOtp, verifyStaffOtp } from './controllers/authController.js';
import { requestOtp, verifyOtp, getCustomerMe } from './controllers/customerAuthController.js';
import {
  requestOtp as requestRiderOtp,
  verifyOtp as verifyRiderOtp,
  register as registerRider,
  requireSignupTicket
} from './controllers/riderAuthController.js';
import { getCoverage } from './controllers/geoController.js';
import {
  getServiceable,
  getShopProducts,
  searchProducts
} from './controllers/customerCatalogController.js';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart
} from './controllers/customerCartController.js';
import {
  listAddresses,
  createAddress,
  deleteAddress
} from './controllers/customerAddressController.js';
import {
  placeOrder,
  listOrders,
  getOrder
} from './controllers/customerOrderController.js';
import { getOverview } from './controllers/dashboardController.js';
import {
  createPartner,
  getPendingApprovals,
  approvePartner,
  rejectPartner,
  setPartnerLocation,
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
import {
  listConfig,
  updateConfig,
  deleteConfig
} from './controllers/masterConfigController.js';
import {
  listOffers,
  acceptOffer,
  rejectOffer,
  reportStockout,
  listShopOrders,
  updateShopOrderStatus
} from './controllers/shopOrderController.js';
import {
  requireRider,
  toggleShift,
  updateLocation,
  listJobs,
  pickUp,
  deliver,
  reportDeadRun,
  getRemittanceSummary,
  remitCash,
  getEarnings
} from './controllers/riderController.js';
import {
  getDistrictRevenue,
  getDistrictRevenueDetail
} from './controllers/revenueController.js';
import { createOrderPayment, razorpayWebhook, paymentPage } from './controllers/paymentController.js';
import { getCodOutstanding } from './controllers/financeController.js';
import {
  uploadPrescription,
  listPrescriptions,
  approvePrescription,
  rejectPrescription
} from './controllers/prescriptionController.js';
import { lookupVoucher, redeem } from './controllers/voucherController.js';
import {
  listInventory,
  addInventory,
  updateInventory,
  confirmInventory,
  getStorefront,
  updateStorefront
} from './controllers/shopInventoryController.js';
import {
  listShopRiders,
  createShopRider,
  updateShopRider
} from './controllers/shopRiderController.js';
import {
  getMyBilling,
  createInvoicePaymentLink,
  listBilling,
  markInvoicePaid,
  voidInvoice,
  cancelSubscription
} from './controllers/billingController.js';
import { registerDevice } from './controllers/deviceController.js';
import {
  signStaffUpload,
  signCustomerUpload,
  signProductUpload,
  signBannerUpload,
  signTaxonomyUpload,
  signRiderDocUpload
} from './controllers/uploadController.js';
import {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  listCustomerBanners,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  setCollectionItems,
  listCustomerCollections
} from './controllers/merchandisingController.js';
import {
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listCustomerCoupons
} from './controllers/couponController.js';
import {
  listIndustriesForMaster,
  updateIndustry,
  setIndustryOrder,
  listCategoriesForMaster,
  createCategory,
  updateCategory,
  deleteCategory,
  listCustomerCategories,
  INDUSTRY_ORDER
} from './controllers/taxonomyController.js';

const app = express();

// gzip, before anything that writes a body.
//
// Every response this API sends is JSON, and the big ones are lists of near
// identical objects — a shop's shelf is 50 rows of the same twenty keys, each
// with a nested product, category and add-on array. That compresses by roughly
// 80%, and it is bytes over a mobile connection in India, which is the part of
// the round trip the platform does not control.
//
// It reads the client's `Accept-Encoding` and does nothing for a client that did
// not ask, so the 7 web dashboards, the six apps and curl all keep working
// unchanged. `compression` skips anything already compressed and anything under
// its threshold, so the small responses this API mostly sends pay nothing.
//
// ⚠️ Response-side only: `req.rawBody` below is the *request* body and the
// Razorpay signature check is untouched by this.
app.use(compression());

// Middleware
// Normalize allowed origins: trim whitespace and strip any trailing slash so
// "https://foo.app/" in config still matches the browser origin "https://foo.app".
const normalizeOrigin = (o) => o.trim().replace(/\/+$/, '');
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

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
// `verify` stashes the exact raw bytes of every request body on `req.rawBody`.
// Cheap for the vast majority of routes that never look at it; the Razorpay
// webhook is the one route that must verify a signature against the raw
// payload rather than a re-serialised `req.body`, since those are not
// guaranteed to be byte-identical.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Liveness probe — no auth, no database.
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Razorpay webhook — public. The HMAC signature on the raw body is the
// authentication; nothing here trusts the client's own checkout callback
// (HANDOFF §3 / PLAN §8).
app.post('/api/payments/razorpay/webhook', razorpayWebhook);

// The hosted checkout page (2026-08-12) — a page for a browser, which is why it
// is not under `/api` and carries no auth middleware. The signed ticket in its
// query string is the authorisation, it is bound to one order, and it can pay
// but cannot read anything else or mark anything paid. See
// `lib/paymentPageToken.js`.
app.get('/pay/:orderId', paymentPage);

// Public Auth routes
app.post('/api/auth/login', login);

// The same account, a second door (2026-08-12). Public for the same reason
// `login` is: somebody signing in has no session yet. Both return the identical
// token and `publicUser` shape, so nothing downstream knows which was used.
//
// ⚠️ The 7 web dashboards use `login` only and must keep it — see the block
// comment on `requestStaffOtp`.
app.post('/api/auth/otp/request', requestStaffOtp);
app.post('/api/auth/otp/verify', verifyStaffOtp);

// --- Rider self-registration (2026-08-11) ------------------------------------
// Mounted here, **before** `app.use('/api', protect)`, and that is the whole
// difficulty of this feature: somebody applying to be a delivery partner has no
// account for `protect` to resolve, and will not have one for days.
//
// What stands in for a session is `requireSignupTicket` — the 15-minute,
// phone-bound ticket minted when the OTP verified (`lib/riderSignupToken.js`).
// The two open routes take a phone number and nothing else; the two ticketed ones
// read the phone **out of the ticket**, so no caller can act on a number they did
// not prove they hold.
//
// ⚠️ `register` hard-codes `role`, `executiveType`, `isActive: false` and
// `employerShopId: null` rather than reading them. Unlike `POST
// /api/partners/create` below — which takes `role` from its body quite safely,
// because it sits behind `protect` — this route is open to the internet, so a
// `role: 'MASTER'` in the payload must be something the code cannot express.
app.post('/api/rider/auth/otp/request', requestRiderOtp);
app.post('/api/rider/auth/otp/verify', verifyRiderOtp);
app.post('/api/rider/auth/register', requireSignupTicket, registerRider);
// A licence or Aadhaar photo, uploaded before the account exists. Its own upload
// audience (`rider-signup`), so a ticket can reach exactly one kind and cannot
// sign a proof-of-delivery photo against a stranger's job.
app.post('/api/rider/auth/uploads/signature', requireSignupTicket, signRiderDocUpload);

// Public: where RoadMate has somebody on the ground, as the exact strings the
// partner rows carry. The registration form renders these as pickers so an
// applicant's `districtName` is byte-identical to their approver's — see
// `geoController` for why a typed district is invisible to every approval queue.
app.get('/api/geo/coverage', getCoverage);

// Public: Industries list — dashboard form dropdowns, and the Customer app's
// industry rail (2026-08-10).
//
// ⚠️ The order changed and the shape did not. `INDUSTRY_ORDER` is `sortOrder`
// then `name`, so a platform that has never touched `sortOrder` has every row at
// 0 and still comes back alphabetically — byte-identical to what the seven
// dashboards have always received. What is new is that the client can now put
// Grocery first, which is an editorial decision the home screen should not be
// making by accident of the alphabet.
app.get('/api/industries', async (req, res) => {
  try {
    const industries = await prisma.industry.findMany({ orderBy: INDUSTRY_ORDER });
    res.status(200).json({ status: 'success', industries });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load industries.' });
  }
});

// --- Customer (B2C) ----------------------------------------------------------
// Mounted before the staff `protect` guard below: these routes terminate the
// request themselves, and customers are authenticated by `protectCustomer`,
// which resolves `Customer` rather than `User`.
app.post('/api/customer/auth/otp/request', requestOtp);
app.post('/api/customer/auth/otp/verify', verifyOtp);

app.get('/api/customer/me', protectCustomer, getCustomerMe);

// Serviceability + catalog (Phase 1.2 / 1.3)
app.get('/api/customer/serviceable', protectCustomer, getServiceable);
app.get('/api/customer/products', protectCustomer, searchProducts);
app.get('/api/customer/shops/:shopId/products', protectCustomer, getShopProducts);

// Address book — placement takes an addressId, so this is part of 1.4.
app.get('/api/customer/addresses', protectCustomer, listAddresses);
app.post('/api/customer/addresses', protectCustomer, createAddress);
app.delete('/api/customer/addresses/:addressId', protectCustomer, deleteAddress);

// Cart (Phase 1.3) — one cart per shop; carts never span shops.
app.get('/api/customer/cart', protectCustomer, getCart);
app.post('/api/customer/cart/items', protectCustomer, addCartItem);
app.patch('/api/customer/cart/items/:itemId', protectCustomer, updateCartItem);
app.delete('/api/customer/cart/items/:itemId', protectCustomer, removeCartItem);
app.delete('/api/customer/cart/:cartId', protectCustomer, clearCart);

// Orders (Phase 1.4)
app.post('/api/customer/orders', protectCustomer, placeOrder);
app.get('/api/customer/orders', protectCustomer, listOrders);
app.get('/api/customer/orders/:orderId', protectCustomer, getOrder);

// Razorpay checkout order (Phase 1.8) — PREPAID only; COD needs none of this.
app.post('/api/customer/orders/:orderId/razorpay-order', protectCustomer, createOrderPayment);

// Prescription upload (Phase 1.9, VERIFY_AND_DELIVER) — takes a URL, because
// file storage is not bought yet (PLAN §6). The order stays PLACED, and its
// shop's shelf keeps the reservation, until a verifier approves this.
app.post('/api/customer/orders/:orderId/prescription', protectCustomer, uploadPrescription);

// The signature that lets a phone upload a prescription straight to Cloudinary.
// The API secret never leaves the server and the bytes never transit this API.
// A prescription is stored as an `authenticated` asset — a medical record, not
// a product photo — and that is baked into the signature, so the app cannot
// widen it (`lib/cloudinary.js`).
app.post('/api/customer/uploads/signature', protectCustomer, signCustomerUpload);

// The offers a customer can see (PHASE A.3). Until this existed a customer had
// to already know a code to type, so every coupon the platform ran was invisible
// to anybody who had not been told about it out of band. It filters out only
// what is certainly unusable — `resolveCoupon` at checkout is still the
// authority, and re-checks everything against the actual cart.
app.get('/api/customer/coupons', protectCustomer, listCustomerCoupons);

// The merchandising surface, customer side (PHASE B). Both are live-only and
// apply their window in the query — a festival banner stops appearing the moment
// it expires, with nothing having to run.
app.get('/api/customer/banners', protectCustomer, listCustomerBanners);
app.get('/api/customer/collections', protectCustomer, listCustomerCollections);

// The category row under the banner strip (the storefront pass, 2026-08-10).
// The industry's own shape, not this address's inventory — see the handler.
app.get('/api/customer/categories', protectCustomer, listCustomerCategories);

// Push registration (Phase 4 side) — same handler as the staff route below;
// `DeviceToken_owner_xor` is what stops a device belonging to both.
app.post('/api/customer/devices', protectCustomer, registerDevice);

// Protected routes (require valid JWT)
app.use('/api', protect);

// Auth - Me session
app.get('/api/auth/me', getMe);

// Push registration (Phase 2) — register after sign-in so the 60-second offer
// window actually buzzes someone's phone.
app.post('/api/devices', registerDevice);

// Dashboard stats
app.get('/api/dashboard/overview', getOverview);

// Partner Onboarding & Approvals
app.post('/api/partners/create', createPartner);
app.get('/api/partners/pending', getPendingApprovals);
app.get('/api/partners/active', getActivePartners);
app.post('/api/partners/:id/approve', approvePartner);
app.post('/api/partners/:id/reject', rejectPartner);

// Where a shop is. `createPartner` refuses to onboard a SHOP without
// coordinates, which does nothing for the shops already onboarded without them
// — and a shop with NULL coordinates is not merely unranked, it is invisible to
// every customer with nothing reporting it missing. This is the operator's way
// to place one; the shop's own is `PATCH /api/shop/storefront`.
app.patch('/api/partners/:id/location', setPartnerLocation);

// Partner Expenses
app.get('/api/expenses', getExpenses);
app.post('/api/expenses/create', createExpense);

// Catalog Products CRUD
app.get('/api/products', getProducts);
app.post('/api/products/create', createProduct);
app.put('/api/products/:id', updateProduct);
app.delete('/api/products/:id', deleteProduct);

// A catalogue photo, uploaded straight to Cloudinary by whoever is editing the
// product. Role-guarded here rather than inside the handler, because the route
// table is what decides an audience — the same rule the rider and customer
// signature routes follow. A rider is behind the same `protect` guard as a
// manufacturer and has no business signing a catalogue asset.
app.post(
  '/api/products/uploads/signature',
  restrictTo('MASTER', 'MANUFACTURER', 'DISTRIBUTOR', 'SHOP'),
  signProductUpload
);

// Master-only aggregated views (role-guarded by JWT)
app.get('/api/master/states', getStatesOverview);
app.get('/api/master/districts', getDistrictsOverview);

// Platform settings — every tunable number in one place, MASTER only. Until
// this existed all 13+ keys needed a developer running a script, which made
// every "set it from the dashboard" answer the client gave undeliverable.
app.get('/api/master/config', restrictTo('MASTER'), listConfig);
app.put('/api/master/config', restrictTo('MASTER'), updateConfig);
app.delete('/api/master/config/:key', restrictTo('MASTER'), deleteConfig);

// Coupons (PHASE A.3). The model and `resolveCoupon()` have been complete since
// Phase 1; there was no API and no screen, so a coupon could only be inserted by
// hand with SQL — which means none ever had been. MASTER only, like every other
// commercial lever here. ⚠️ DELETE only ever removes a coupon nobody has used:
// a used one is the recorded reason a delivered order was discounted.
app.get('/api/master/coupons', restrictTo('MASTER'), listCoupons);
app.post('/api/master/coupons', restrictTo('MASTER'), createCoupon);
app.patch('/api/master/coupons/:id', restrictTo('MASTER'), updateCoupon);
app.delete('/api/master/coupons/:id', restrictTo('MASTER'), deleteCoupon);

// --- Merchandising (PHASE B) --------------------------------------------------
// Ordering has worked end to end since Phase 1; promoting did not exist at all.
// A banner carries a validity window so a festival strip switches itself off; a
// collection is a curated ordered list and has no money in it anywhere.
app.get('/api/master/banners', restrictTo('MASTER'), listBanners);
app.post('/api/master/banners', restrictTo('MASTER'), createBanner);
app.patch('/api/master/banners/:id', restrictTo('MASTER'), updateBanner);
app.delete('/api/master/banners/:id', restrictTo('MASTER'), deleteBanner);
app.post('/api/master/banners/uploads/signature', restrictTo('MASTER'), signBannerUpload);

app.get('/api/master/collections', restrictTo('MASTER'), listCollections);
app.post('/api/master/collections', restrictTo('MASTER'), createCollection);
app.patch('/api/master/collections/:id', restrictTo('MASTER'), updateCollection);
app.delete('/api/master/collections/:id', restrictTo('MASTER'), deleteCollection);
// A whole-list replace, because order *is* the content — three verbs would make
// "move this to the top" a sequence that can half-fail.
app.put('/api/master/collections/:id/items', restrictTo('MASTER'), setCollectionItems);

// --- Taxonomy: the two rails on the customer's home screen (2026-08-10) -------
// `Industry.iconUrl` and `Category.iconUrl` have been in the schema since Phase 0
// with nothing able to write to either. These are what turn them on.
//
// ⚠️ Industries are PATCH-only — no create, no delete. An industry owns products,
// shops, orders, coupons and config rows, and it is the switch `lib/fulfilment.js`
// reads; only its presentation is editable here. Categories are full CRUD because
// a category is presentation plus a filter, and deleting one is refused while
// products are filed under it.
app.get('/api/master/industries', restrictTo('MASTER'), listIndustriesForMaster);
app.patch('/api/master/industries/:id', restrictTo('MASTER'), updateIndustry);
app.put('/api/master/industries/order', restrictTo('MASTER'), setIndustryOrder);

app.get('/api/master/categories', restrictTo('MASTER'), listCategoriesForMaster);
app.post('/api/master/categories', restrictTo('MASTER'), createCategory);
app.patch('/api/master/categories/:id', restrictTo('MASTER'), updateCategory);
app.delete('/api/master/categories/:id', restrictTo('MASTER'), deleteCategory);

// One signature route for both rails: `TAXONOMY_ICON` is a single kind with a
// single policy, and the route above is what says whether it lands on an
// industry or a category (`lib/cloudinary.js`).
app.post('/api/master/taxonomy/uploads/signature', restrictTo('MASTER'), signTaxonomyUpload);

// --- Partner subscriptions (HANDOFF §7ter) ------------------------------------
// The partner's own side: what their trial is, what they owe, and a link to pay
// it with. Any signed-in staff user may ask — a role that is never billed gets
// `billable: false`, which is what a banner needs in order to render nothing.
app.get('/api/billing/me', getMyBilling);
app.post('/api/billing/invoices/:invoiceId/pay-link', createInvoicePaymentLink);

// The platform's side. MASTER only, like every other money view here: this is
// every partner's standing, and marking an invoice paid is recording that money
// arrived.
app.get('/api/master/billing', restrictTo('MASTER'), listBilling);
app.post('/api/master/billing/invoices/:invoiceId/mark-paid', restrictTo('MASTER'), markInvoicePaid);
app.post('/api/master/billing/invoices/:invoiceId/void', restrictTo('MASTER'), voidInvoice);
app.post('/api/master/billing/partners/:userId/cancel', restrictTo('MASTER'), cancelSubscription);

// District revenue summary + per-category drill-down
app.get('/api/district/revenue', getDistrictRevenue);
app.get('/api/district/revenue/:category', getDistrictRevenueDetail);

// --- Shop: the B2C side of the hinge (Phase 1.6) ------------------------------
// Staff auth, SHOP role only. An offer is answered here or it times out.
app.get('/api/shop/offers', restrictTo('SHOP'), listOffers);
app.post('/api/shop/offers/:orderId/accept', restrictTo('SHOP'), acceptOffer);
app.post('/api/shop/offers/:orderId/reject', restrictTo('SHOP'), rejectOffer);
app.get('/api/shop/orders', restrictTo('SHOP'), listShopOrders);
app.patch('/api/shop/orders/:orderId/status', restrictTo('SHOP'), updateShopOrderStatus);
app.post('/api/shop/orders/:orderId/stockout', restrictTo('SHOP'), reportStockout);

// Stock, from the side of the human who owns it (Phase 2). Everything else that
// touches `ShopInventory` is either the pipeline writing it or the customer app
// reading it; this is the shop correcting it. `/confirm` is HANDOFF §3's
// "until re-confirmed" — the only way back from an auto-hidden SKU.
app.get('/api/shop/inventory', restrictTo('SHOP'), listInventory);
app.post('/api/shop/inventory', restrictTo('SHOP'), addInventory);
app.patch('/api/shop/inventory/:inventoryId', restrictTo('SHOP'), updateInventory);
app.post('/api/shop/inventory/:inventoryId/confirm', restrictTo('SHOP'), confirmInventory);

// The Home screen's "Shop is open" toggle. Not cosmetic — `rankCandidateShops`
// only considers open shops, so this is the shop's switch out of the pool.
app.get('/api/shop/storefront', restrictTo('SHOP'), getStorefront);
app.patch('/api/shop/storefront', restrictTo('SHOP'), updateStorefront);

// The shop's own delivery boys (HANDOFF §3, two delivery modes). The *shop*
// hires them, not a field executive: a field executive onboards shops and does
// not know a shop's employees. The mode switch itself lives on the storefront
// above, next to "Shop is open", because both decide what routing does here.
app.get('/api/shop/riders', restrictTo('SHOP'), listShopRiders);
app.post('/api/shop/riders', restrictTo('SHOP'), createShopRider);
app.patch('/api/shop/riders/:riderId', restrictTo('SHOP'), updateShopRider);

// NO_DELIVERY (Phase 1.9) — the counter honouring a membership. No rider and
// no delivery job was ever involved; this is the whole fulfilment.
app.get('/api/shop/vouchers/:code', restrictTo('SHOP'), lookupVoucher);
app.post('/api/shop/vouchers/redeem', restrictTo('SHOP'), redeem);

// --- Prescription verification (Phase 1.9, VERIFY_AND_DELIVER) ----------------
// Platform staff, not the shop: the order has not reached a shop yet, and a
// shop verifying an order it is about to be paid for is the wrong incentive.
app.get('/api/pharmacy/prescriptions', restrictTo('MASTER'), listPrescriptions);
app.post('/api/pharmacy/prescriptions/:prescriptionId/approve', restrictTo('MASTER'), approvePrescription);
app.post('/api/pharmacy/prescriptions/:prescriptionId/reject', restrictTo('MASTER'), rejectPrescription);

// --- Rider: the last mile (Phase 1.7) -----------------------------------------
// `requireRider` on top of `protect`, because a rider is EXECUTIVE *and*
// executiveType=DELIVERY — the role alone also covers listing executives.
app.post('/api/rider/shift', requireRider, toggleShift);
app.post('/api/rider/location', requireRider, updateLocation);
app.get('/api/rider/jobs', requireRider, listJobs);
app.post('/api/rider/jobs/:jobId/pickup', requireRider, pickUp);
app.post('/api/rider/jobs/:jobId/deliver', requireRider, deliver);
app.post('/api/rider/jobs/:jobId/dead-run', requireRider, reportDeadRun);

// Proof of delivery: the same signed-upload seam as the customer's, restricted
// to riders. `requireRider` and not bare `protect` — a shop or a manufacturer
// has no business writing into the proof-of-delivery folder.
app.post('/api/rider/uploads/signature', requireRider, signStaffUpload);

// COD cash-in-hand (Phase 1.8) — what this rider is holding, and handing it in.
// Rider pay (Phase 3's earnings screen) — frozen `riderEarning` columns and
// settled periods, never a recomputation.
app.get('/api/rider/earnings', requireRider, getEarnings);

app.get('/api/rider/remittance', requireRider, getRemittanceSummary);
app.post('/api/rider/remittance', requireRider, remitCash);

// --- Finance: cross-rider reconciliation (Phase 1.8) --------------------------
app.get('/api/finance/cod-outstanding', restrictTo('MASTER'), getCodOutstanding);

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

export default app;
export { allowedOrigins };
