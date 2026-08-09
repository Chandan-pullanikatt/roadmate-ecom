// Test-database lifecycle: truncate, seed fixtures, disconnect.
//
// The schema itself is applied once per run by `npm run test:db:reset`
// (prisma migrate reset), not here — pushing schema per test file is slow and
// racy. This module only manages *rows*.
import './env.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../src/lib/prisma.js';
import { signCustomerToken } from '../../src/lib/customerToken.js';

// Every table except Prisma's own migration bookkeeping. Order does not matter:
// one TRUNCATE ... CASCADE statement handles the foreign keys.
const TABLES = [
  'DeviceToken', 'Voucher', 'Prescription', 'Coupon', 'SettlementLine', 'Settlement',
  'RiderSettlementLine', 'RiderSettlement',
  'SubscriptionInvoice', 'PartnerSubscription',
  'Payment', 'RiderShift', 'DeliveryRoute', 'DeliveryJob', 'FulfilmentAttempt',
  'ConsumerOrderItem', 'ConsumerOrder', 'CartItem', 'Cart', 'Address', 'OtpToken',
  'Customer', 'ShopInventory', 'ProductAddOn', 'ProductVariant', 'Category',
  'Payout', 'Expense', 'TradeOrderItem', 'TradeOrder', 'BrandDistributorMapping',
  'Product', 'User', 'Industry', 'PlatformConfig'
];

/** Wipe every row and restart identity sequences, so ids are predictable. */
export async function resetDb() {
  const list = TABLES.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

/**
 * The minimum world a test needs: one industry, one master user, one shop.
 * Tests that need more build on top of what this returns.
 */
export async function seedBaseline() {
  const password = await bcrypt.hash('test1234', 10);

  const industry = await prisma.industry.create({
    data: { name: 'Grocery', slug: 'grocery', fulfilmentType: 'PICK_AND_DELIVER' }
  });

  const master = await prisma.user.create({
    data: {
      email: 'master@test.roadmate',
      password,
      name: 'Test Master',
      role: 'MASTER',
      isActive: true
    }
  });

  const shop = await prisma.user.create({
    data: {
      email: 'shop@test.roadmate',
      password,
      name: 'Test Shop',
      role: 'SHOP',
      isActive: true,
      isOpen: true,
      industryId: industry.id,
      latitude: 12.9716,
      longitude: 77.5946,
      serviceRadiusKm: 5,
      safetyStockBuffer: 90
    }
  });

  await prisma.platformConfig.createMany({
    data: [
      { key: 'accept_window_seconds', value: '60' },
      { key: 'default_radius_km', value: '5' },
      { key: 'commission_percent', value: '15' },
      { key: 'fulfilment_rate_threshold', value: '85' }
    ]
  });

  return { industry, master, shop, password: 'test1234' };
}

/** A staff JWT matching what `POST /api/auth/login` issues. */
export function tokenFor(user) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });
}

/** A customer JWT matching what `POST /api/customer/auth/otp/verify` issues. */
export function customerTokenFor(customer) {
  return signCustomerToken(customer.id);
}

export async function disconnect() {
  await prisma.$disconnect();
}

export { prisma };
