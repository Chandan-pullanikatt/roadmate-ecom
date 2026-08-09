// The reason B2C money moved off Float: a COD ledger must reconcile to the
// paisa. These tests fail if anyone converts these columns back.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedBaseline, disconnect, prisma } from './helpers/db.js';

let world;

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
});

after(async () => {
  await disconnect();
});

async function makeCustomerWithAddress() {
  const customer = await prisma.customer.create({ data: { phone: '9000000001' } });
  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      line1: '1 Test Street',
      latitude: 12.9716,
      longitude: 77.5946
    }
  });
  return { customer, address };
}

test('ConsumerOrder money survives the round trip exactly', async () => {
  const { customer, address } = await makeCustomerWithAddress();

  const order = await prisma.consumerOrder.create({
    data: {
      orderNumber: 'TEST-0001',
      customerId: customer.id,
      addressId: address.id,
      industryId: world.industry.id,
      subtotal: '0.10',
      taxAmount: '0.20',
      deliveryFee: '0.30',
      grandTotal: '0.60'
    }
  });

  // Float would give 0.6000000000000001 here.
  assert.equal(order.subtotal.toString(), '0.1');
  assert.equal(
    order.subtotal.plus(order.taxAmount).plus(order.deliveryFee).toString(),
    order.grandTotal.toString()
  );
});

test('a 3-paisa split of a large order still sums back to the total', async () => {
  const { customer, address } = await makeCustomerWithAddress();

  // Deliberately awkward: 15% commission on 8,431.37.
  const grandTotal = '8431.37';
  const commission = '1264.71'; // 15% rounded to paisa
  const shopPayable = '7166.66';

  const order = await prisma.consumerOrder.create({
    data: {
      orderNumber: 'TEST-0002',
      customerId: customer.id,
      addressId: address.id,
      industryId: world.industry.id,
      subtotal: grandTotal,
      grandTotal,
      platformCommission: commission,
      shopPayable
    }
  });

  assert.equal(
    order.platformCommission.plus(order.shopPayable).toString(),
    order.grandTotal.toString()
  );
});

test('money columns are stored as numeric, not double precision', async () => {
  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'ConsumerOrder' AND column_name IN
          ('subtotal','taxAmount','deliveryFee','discountAmount','tipAmount',
           'grandTotal','platformCommission','shopPayable'))
        OR (table_name = 'ConsumerOrderItem' AND column_name = 'unitPrice')
        OR (table_name = 'Payment' AND column_name IN ('amount','refundAmount'))
        OR (table_name = 'Settlement' AND column_name IN
          ('grossSales','commission','codCollected','deductions','netPayable'))
        OR (table_name = 'SettlementLine' AND column_name IN ('gross','commission','net'))
        OR (table_name = 'ShopInventory' AND column_name = 'sellingPrice')
        OR (table_name = 'ProductVariant' AND column_name IN ('price','mrp'))
        OR (table_name = 'ProductAddOn' AND column_name = 'price')
        OR (table_name = 'Coupon' AND column_name IN
          ('discountValue','maxDiscount','minOrderValue'))
        OR (table_name = 'DeliveryJob' AND column_name IN ('riderEarning','deadRunFee'))
      )
  `;

  // 8 ConsumerOrder + 1 item + 2 Payment + 5 Settlement + 3 SettlementLine
  // + 1 ShopInventory + 2 ProductVariant + 1 ProductAddOn + 3 Coupon + 2 DeliveryJob
  assert.equal(rows.length, 28, 'expected all 28 B2C money columns to exist');
  const floats = rows.filter((r) => r.data_type !== 'numeric');
  assert.deepEqual(floats, [], 'these money columns are still floating point');
});

test('B2B money is deliberately left as Float — 7 dashboards read it', async () => {
  const rows = await prisma.$queryRaw`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TradeOrder'
      AND column_name = 'totalAmount'
  `;
  assert.equal(rows[0].data_type, 'double precision');
});
