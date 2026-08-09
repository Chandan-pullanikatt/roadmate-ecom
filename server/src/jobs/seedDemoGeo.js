// Put the seeded world somewhere real, so the Customer app has something to show.
// `npm run demo:geo -- <lat> <lng>`
//
// WHY THIS EXISTS: `prisma/seed.js` creates eleven shops, five products and
// eleven riders — and none of it is reachable by a customer. Every shop has
// `latitude`/`longitude` NULL and `isOpen` false, there is not one
// `ShopInventory` row, and no rider is on shift. The Customer app therefore
// answers "we don't deliver here yet" and shows an empty screen, which looks
// exactly like a broken build rather than like empty data.
//
// Serviceability is four separate conditions, and the app is empty if ANY of
// them fails (`src/lib/shopRanking.js`):
//
//   1. a shop within its `serviceRadiusKm` of the customer
//   2. that shop `isOpen`
//   3. that shop holding sellable stock — `quantity - reserved`, after the
//      safety buffer
//   4. a delivery rider ON SHIFT with a recent position within `rider_range_km`
//
// This script satisfies all four around a point you give it. It is **demo data
// only**: it never runs in production, and it touches nothing but the rows
// `seed.js` created.
//
// ⚠️ Pass YOUR OWN coordinates. The shops are named after Hyderabad
// neighbourhoods, so that is the default — but if your phone is in Kochi, a
// shop in Hyderabad is 700 km outside its 5 km radius and the app stays empty.
// Open Google Maps, long-press where you are, and copy the two numbers.
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';

dotenv.config();

// Hyderabad, near Ameerpet — chosen because the seeded shops are named after
// Hyderabad neighbourhoods, not because it is where you are.
const DEFAULT_LAT = 17.4374;
const DEFAULT_LNG = 78.4487;

/** Roughly `km` north/east of a point. Good enough for a demo, not for routing. */
const offset = (lat, lng, northKm, eastKm) => ({
  latitude: lat + northKm / 111,
  longitude: lng + eastKm / (111 * Math.cos((lat * Math.PI) / 180))
});

// Spread the shops around the point rather than stacking them: the app sorts by
// distance and shows "1.2 km", so eleven shops at one pin looks fake and hides
// the ranking entirely.
const SPREAD = [
  [0.4, 0.3], [-0.6, 0.5], [0.9, -0.4], [-0.3, -0.8], [1.2, 0.9],
  [-1.1, 0.2], [0.2, 1.4], [-0.9, -1.2], [1.5, -0.7], [-1.4, 1.1], [0.7, -1.5]
];

async function main() {
  const [latArg, lngArg] = process.argv.slice(2);
  const lat = latArg ? Number.parseFloat(latArg) : DEFAULT_LAT;
  const lng = lngArg ? Number.parseFloat(lngArg) : DEFAULT_LNG;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    console.error('[demo:geo] usage: npm run demo:geo -- <lat> <lng>   e.g. 17.4374 78.4487');
    process.exitCode = 1;
    return;
  }
  if (!latArg) {
    console.log('[demo:geo] ⚠️  no coordinates given — using Hyderabad. If your phone is elsewhere,');
    console.log('[demo:geo]     the app will still say "we don\'t deliver here yet".');
  }

  console.log(`[demo:geo] centring the demo world on ${lat}, ${lng}`);

  // 1 + 2 — place the shops and open them.
  const shops = await prisma.user.findMany({ where: { role: 'SHOP' }, orderBy: { id: 'asc' } });
  for (const [i, shop] of shops.entries()) {
    const [northKm, eastKm] = SPREAD[i % SPREAD.length];
    await prisma.user.update({
      where: { id: shop.id },
      data: {
        ...offset(lat, lng, northKm, eastKm),
        isOpen: true,
        serviceRadiusKm: shop.serviceRadiusKm ?? 5
      }
    });
  }
  console.log(`[demo:geo] ${shops.length} shop(s) placed and opened`);

  // 3 — stock every shelf. `sellableQty()` is what the customer sees, and it
  // applies the shop's safety buffer, so 40 units shows as ~36 rather than 40.
  const products = await prisma.product.findMany();
  if (products.length === 0) {
    console.log('[demo:geo] ⚠️  no products exist — run `npm run prisma:seed` first');
  }

  let stocked = 0;
  for (const shop of shops) {
    for (const product of products) {
      const existing = await prisma.shopInventory.findFirst({
        where: { shopId: shop.id, productId: product.id, variantId: null }
      });
      if (existing) continue;
      await prisma.shopInventory.create({
        data: {
          shopId: shop.id,
          productId: product.id,
          // Deliberately uneven, and one line deliberately low: "only 3 left"
          // under five units is a real behaviour worth seeing on screen.
          quantity: [40, 25, 12, 3, 60][stocked % 5],
          sellingPrice: product.price,
          isAvailable: true
        }
      });
      stocked += 1;
    }
  }
  console.log(`[demo:geo] ${stocked} shelf row(s) created`);

  // 4 — a rider on shift, with a position. Without this every shop is filtered
  // out of serviceability and the app says NO_RIDER, which is a different empty
  // screen from NO_SHOP and is the one people misread as a bug.
  const riders = await prisma.user.findMany({
    where: { role: 'EXECUTIVE', executiveType: 'DELIVERY', employerShopId: null },
    take: 3,
    orderBy: { id: 'asc' }
  });
  for (const [i, rider] of riders.entries()) {
    await prisma.user.update({
      where: { id: rider.id },
      data: {
        isOnShift: true,
        isActive: true,
        lastLat: offset(lat, lng, i * 0.3, i * 0.2).latitude,
        lastLng: offset(lat, lng, i * 0.3, i * 0.2).longitude,
        lastLocationAt: new Date()
      }
    });
  }
  console.log(`[demo:geo] ${riders.length} rider(s) on shift near you`);

  console.log('[demo:geo] done. The Customer app should now find shops at this location.');
  console.log('[demo:geo] Remember: `npm run server` AND `npm run sweeper` both have to be running.');
}

main()
  .catch((err) => {
    console.error('[demo:geo] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
