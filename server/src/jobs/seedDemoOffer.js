// Put one live offer in a shop's inbox, so the Orders tab can be demonstrated.
// `npm run demo:offer` — or `npm run demo:offer -- <shop-email>`
//
// WHY THIS EXISTS: the Orders tab is the screen the Shop app is *for* — the
// 60-second countdown, accept, "start packing", "mark ready for pickup" — and a
// freshly seeded database has zero `ConsumerOrder` rows, so it sits on "Nothing
// waiting" and none of that flow can be shown. `demo:geo` makes shops findable
// and `demo:storefront` makes them look stocked; neither places an order,
// because placing one is the *customer's* job and the Customer app is a second
// bundler and a second dev client away.
//
// ⚠️ **This is not a fake row shortcut.** It goes through the real routing
// functions — `reserveLines` takes the stock off the shelf under the same row
// lock the live path uses, and `openFirstAttempt` opens sequence 1 with the
// window length from `PlatformConfig`. So what appears on the phone is a
// genuine offer: it expires, the sweeper reroutes it, accepting it is still the
// conditional claim that can 409, and the units really are held. A hand-written
// `fulfilmentAttempt.create` would have looked identical on screen and behaved
// like nothing at all.
//
// ⚠️ **The offer really does expire.** The accept window is 60 seconds and
// `npm run sweeper` enforces it, so run this while you are looking at the phone.
// It is re-runnable: every call places a new order, so fire another whenever the
// last one times out.
//
// Demo data only. It touches nothing but the rows `seed.js` created, and it
// refuses to run against a shop that `demo:geo` has not placed — an unplaced
// shop is one no customer could have reached in the first place.
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';
import { orderLines, reserveLines, openFirstAttempt } from '../lib/routing.js';

dotenv.config();

// The seeded demo shop. Overridable, because the second district's shops are
// just as valid a target and a demo may want one of them.
const DEFAULT_SHOP_EMAIL = 'shop@roadmate.com';

// A customer who exists only for this script. Reused across runs rather than
// multiplied — `Customer.phone` is unique, which is what makes that automatic.
const DEMO_CUSTOMER_PHONE = '9800000001';

async function main() {
  const [shopEmail = DEFAULT_SHOP_EMAIL] = process.argv.slice(2);

  const shop = await prisma.user.findFirst({
    where: { email: shopEmail, role: 'SHOP' },
    include: { industry: true }
  });

  if (!shop) {
    throw new Error(`No shop with email ${shopEmail}. Run \`npm run prisma:seed\` first.`);
  }

  // Both of these are things `demo:geo` sets. Without them the offer would
  // arrive at a shop that the routing engine itself would never have chosen,
  // which makes the demo a lie about how the platform works.
  if (shop.latitude == null || shop.longitude == null) {
    throw new Error(`${shop.businessName} has no coordinates. Run \`npm run demo:geo\` first.`);
  }
  if (!shop.isOpen) {
    throw new Error(`${shop.businessName} is closed, so it is out of the routing pool. Open it in the app, or run \`npm run demo:geo\`.`);
  }

  // Take the lines off this shop's own shelf. Anything else and `reserveLines`
  // would correctly refuse: a shop cannot be offered goods it does not stock.
  const shelf = await prisma.shopInventory.findMany({
    where: { shopId: shop.id, isAvailable: true, quantity: { gt: 0 } },
    include: { product: true },
    orderBy: { quantity: 'desc' },
    take: 2
  });

  if (shelf.length === 0) {
    throw new Error(`${shop.businessName} has no stock. Run \`npm run demo:storefront\` first.`);
  }

  const customer = await prisma.customer.upsert({
    where: { phone: DEMO_CUSTOMER_PHONE },
    update: {},
    create: { phone: DEMO_CUSTOMER_PHONE, name: 'Demo Customer' }
  });

  // Roughly a kilometre north of the shop: close enough to be inside any
  // sensible `serviceRadiusKm`, far enough that the ETA is not zero.
  const address =
    (await prisma.address.findFirst({ where: { customerId: customer.id } })) ??
    (await prisma.address.create({
      data: {
        customerId: customer.id,
        label: 'Home',
        line1: 'Demo address',
        landmark: 'Near the flyover',
        city: shop.districtName ?? 'Kochi',
        latitude: shop.latitude + 0.009,
        longitude: shop.longitude,
        isDefault: true
      }
    }));

  const lines = shelf.map((row) => ({
    productId: row.productId,
    variantId: row.variantId ?? null,
    quantity: 1,
    unitPrice: row.sellingPrice,
    productName: row.product.name
  }));

  const subtotal = lines.reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0);
  const deliveryFee = 30;
  const grandTotal = subtotal + deliveryFee;

  const attempt = await prisma.$transaction(async (tx) => {
    const order = await tx.consumerOrder.create({
      data: {
        // Unique per run, and legible in a list next to the seeded B2B numbers.
        orderNumber: `DEMO-${Date.now().toString().slice(-8)}`,
        customerId: customer.id,
        addressId: address.id,
        industryId: shop.industryId,
        // No `shopId`: a shop owns the order when it *accepts*, not before. And
        // no `Payment` row, which makes this COD — `isPayableNow` gates only
        // PREPAID, so the offer is live immediately rather than parked behind a
        // webhook that will never arrive in a demo.
        status: 'PLACED',
        subtotal,
        deliveryFee,
        grandTotal,
        instructions: 'Placed by npm run demo:offer',
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            productName: l.productName
          }))
        }
      },
      include: { items: true, address: true, payment: true, industry: true, prescriptions: true }
    });

    // The real reservation, under the real lock. False means the shelf moved
    // between the read above and here, and the honest response is to fail
    // rather than to offer stock nobody is holding.
    const held = await reserveLines(tx, shop, orderLines(order));
    if (!held) {
      throw new Error(`${shop.businessName} could not hold that stock — check the Stock tab.`);
    }

    return openFirstAttempt(tx, order, shop.id);
  },
  // Prisma's interactive-transaction default is 5 seconds, and this does the
  // work of a whole checkout — order, items, a locked reservation per line, the
  // attempt — over a **remote** database. The API gets away with the default on
  // a warm pooled connection; a script run from a laptop against Neon does not,
  // and the first call of the day also pays the cold start. Raised here rather
  // than anywhere shared: this is a latency fact about running demo scripts, not
  // a statement about how long a real checkout may hold its locks.
  { timeout: 20000, maxWait: 10000 });

  const seconds = Math.round((attempt.expiresAt.getTime() - Date.now()) / 1000);

  console.log(`[demo:offer] offered to ${shop.businessName} (${shopEmail})`);
  for (const line of lines) {
    console.log(`[demo:offer]   ${line.quantity} × ${line.productName} @ ₹${Number(line.unitPrice)}`);
  }
  console.log(`[demo:offer] total ₹${grandTotal}, attempt #${attempt.id}, expires in ${seconds}s`);
  console.log('[demo:offer] the Orders tab polls every 5s, so it should appear almost at once.');
  console.log('[demo:offer] ⚠️  `npm run sweeper` must be running or the countdown never actually expires.');
}

main()
  .catch((err) => {
    console.error('[demo:offer] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
