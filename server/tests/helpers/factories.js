// Row factories for the B2C tests. `seedBaseline()` in db.js gives one
// industry / master / shop; anything richer than that is built here so the
// baseline stays small and the Phase 1.1 tests keep their exact world.
import bcrypt from 'bcryptjs';
import prisma from '../../src/lib/prisma.js';

let seq = 0;
const uniq = () => `${Date.now()}-${(seq += 1)}`;

const PASSWORD_HASH = bcrypt.hashSync('test1234', 4);

/**
 * A second industry, with whichever `fulfilmentType` the test is about (§1.9).
 * `seedBaseline` gives one PICK_AND_DELIVER industry; the other three branches
 * need their own.
 */
export function createIndustry({ name = 'Industry', fulfilmentType = 'PICK_AND_DELIVER' } = {}) {
  const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${uniq()}`;
  return prisma.industry.create({ data: { name: `${name} ${uniq()}`, slug, fulfilmentType } });
}

/** A shop at a given point. Defaults mirror `seedBaseline`'s shop. */
export function createShop({
  name = 'Shop',
  industryId,
  latitude,
  longitude,
  serviceRadiusKm = 5,
  isOpen = true,
  isActive = true,
  routingPriority = 0,
  fulfilmentRate = 100,
  safetyStockBuffer = 100,
  prepTimeMin = null,
  usesOwnRiders = false
} = {}) {
  return prisma.user.create({
    data: {
      email: `shop-${uniq()}@test.roadmate`,
      password: PASSWORD_HASH,
      name,
      role: 'SHOP',
      isActive,
      isOpen,
      industryId,
      latitude,
      longitude,
      serviceRadiusKm,
      routingPriority,
      fulfilmentRate,
      safetyStockBuffer,
      prepTimeMin,
      usesOwnRiders
    }
  });
}

/**
 * A delivery executive (rider). On shift by default — serviceability needs one.
 *
 * `employerShopId` is what makes this a *shop's own* delivery boy rather than a
 * RoadMate delivery partner: he may only be given that shop's orders, and he is
 * excluded from the platform pool entirely (HANDOFF §3).
 */
export function createRider({
  name = 'Rider',
  lastLat,
  lastLng,
  isOnShift = true,
  employerShopId = null,
  phone = null
} = {}) {
  return prisma.user.create({
    data: {
      email: `rider-${uniq()}@test.roadmate`,
      password: PASSWORD_HASH,
      name,
      role: 'EXECUTIVE',
      executiveType: 'DELIVERY',
      isActive: true,
      isOnShift,
      employerShopId,
      phone,
      lastLat,
      lastLng,
      lastLocationAt: new Date()
    }
  });
}

export function createProduct({ name = 'Product', industryId, ownerId, price = 100, categoryId } = {}) {
  return prisma.product.create({
    data: {
      name,
      sku: `SKU-${uniq()}`,
      price,
      industryId,
      ownerId,
      categoryId
    }
  });
}

/** Put a product on a shop's shelf. `sellingPrice` is what the customer pays. */
export function stockShop({
  shopId,
  productId,
  variantId = null,
  quantity = 10,
  reserved = 0,
  sellingPrice = 100,
  isAvailable = true
}) {
  return prisma.shopInventory.create({
    data: { shopId, productId, variantId, quantity, reserved, sellingPrice, isAvailable }
  });
}

export function createCustomer({ phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}` } = {}) {
  return prisma.customer.create({ data: { phone } });
}

export function createAddress({ customerId, latitude, longitude, isDefault = true }) {
  return prisma.address.create({
    data: { customerId, line1: '1 Test Road', latitude, longitude, isDefault }
  });
}
