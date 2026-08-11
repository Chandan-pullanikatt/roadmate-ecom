// Put the seeded world somewhere real, so the Customer app has something to show.
// `npm run demo:geo` — or `npm run demo:geo -- <lat> <lng> [district]`
//
// WHY THIS EXISTS: `prisma/seed.js` creates the partner hierarchy, the shops and
// the riders — and none of it is reachable by a customer. Every shop has
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
// This script satisfies all four. It is **demo data only**: it never runs in
// production, and it touches nothing but the rows `seed.js` created.
//
// ── DISTRICT-AWARE SINCE 2026-08-11 ─────────────────────────────────────────
//
// The demo is now Kerala with **two districts, 180 km apart** (Kochi and
// Kozhikode). This script used to stack every shop on the platform around one
// point, which for a two-district world is actively wrong: it would put
// Kozhikode's garages in Kochi harbour, and the Kozhikode district partner's
// dashboard would show shops its own customers could never be offered.
//
// So each shop is placed around **its own district's** centre, read from its
// `districtName`, and each district gets its own riders on shift. A customer in
// Kochi finds Kochi shops; a customer in Kozhikode finds Kozhikode ones; and
// nobody finds both — which is the point, because it is what proves
// serviceability is a real per-shop radius rather than a national on switch.
//
// ⚠️ **Testing on a real phone**: pass your own coordinates and, optionally, the
// district to move to them. Your phone is wherever you are, and a demo centred
// on Kochi shows an empty app to somebody sitting in Kannur.
//
//     npm run demo:geo                          → both districts at their real centres
//     npm run demo:geo -- 10.5276 76.2144       → Kochi's world moves to you, Kozhikode stays put
//     npm run demo:geo -- 11.85 75.35 Kozhikode → Kozhikode's world moves to you instead
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';

dotenv.config();

/**
 * Where each district actually is. The keys must match `districtName` on the
 * seeded rows exactly — that string is what every approval and revenue query
 * matches on (`prisma/seed.js`'s GEOGRAPHY table is the source).
 */
const DISTRICT_CENTRES = {
  Kochi: { lat: 9.9816, lng: 76.2999 },       // near Marine Drive
  Kozhikode: { lat: 11.2588, lng: 75.7804 }   // near Mananchira
};

/** Where a shop goes if its district is not in the table above. */
const FALLBACK = DISTRICT_CENTRES.Kochi;

/** Roughly `km` north/east of a point. Good enough for a demo, not for routing. */
const offset = (lat, lng, northKm, eastKm) => ({
  latitude: lat + northKm / 111,
  longitude: lng + eastKm / (111 * Math.cos((lat * Math.PI) / 180))
});

// Spread the shops around the point rather than stacking them: the app sorts by
// distance and shows "1.2 km", so a dozen shops at one pin looks fake and hides
// the ranking entirely. Kept well inside the 5 km default radius.
const SPREAD = [
  [0.4, 0.3], [-0.6, 0.5], [0.9, -0.4], [-0.3, -0.8], [1.2, 0.9],
  [-1.1, 0.2], [0.2, 1.4], [-0.9, -1.2], [1.5, -0.7], [-1.4, 1.1], [0.7, -1.5]
];

async function main() {
  const [latArg, lngArg, districtArg] = process.argv.slice(2);

  // Which districts exist in the data, not which ones this file knows about —
  // the seed is the authority and a hardcoded list here would silently skip a
  // district somebody adds there.
  const districtRows = await prisma.user.findMany({
    where: { role: 'SHOP', districtName: { not: null } },
    select: { districtName: true },
    distinct: ['districtName']
  });
  const districts = districtRows.map((r) => r.districtName);

  if (districts.length === 0) {
    console.error('[demo:geo] no shops with a district exist — run `npm run prisma:seed` first');
    process.exitCode = 1;
    return;
  }

  // The centre each district's shops will be placed around.
  const centres = new Map(
    districts.map((d) => [d, DISTRICT_CENTRES[d] ?? FALLBACK])
  );

  if (latArg) {
    const lat = Number.parseFloat(latArg);
    const lng = Number.parseFloat(lngArg);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      console.error('[demo:geo] usage: npm run demo:geo -- <lat> <lng> [district]');
      console.error(`[demo:geo] districts in the data: ${districts.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Case-insensitive, because typing "kochi" and getting a silent no-op is a
    // worse experience than being told the name is wrong.
    const target = districtArg
      ? districts.find((d) => d.toLowerCase() === String(districtArg).toLowerCase())
      : districts[0];

    if (!target) {
      console.error(`[demo:geo] unknown district "${districtArg}". Known: ${districts.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    centres.set(target, { lat, lng });
    console.log(`[demo:geo] moving ${target} to your coordinates ${lat}, ${lng}`);
    for (const d of districts) {
      if (d !== target) console.log(`[demo:geo]   ${d} stays at its real centre`);
    }
  } else {
    console.log('[demo:geo] ⚠️  no coordinates given — each district sits at its real centre.');
    console.log('[demo:geo]     If your phone is elsewhere the app will say "we don\'t deliver here yet".');
    console.log('[demo:geo]     Pass your own: npm run demo:geo -- <lat> <lng> [district]');
  }

  // 1 + 2 — place the shops around their own district's centre, and open them.
  //
  // ⚠️ Shops are **not renamed** here any more. They used to be, because the seed
  // called them "Jubilee Hills Auto Shop 1" and a Hyderabad name in a Kochi demo
  // was worse than a generic one. The seed now gives every shop a real
  // locality-appropriate business name, so renaming would overwrite better data
  // with worse.
  let placed = 0;
  for (const district of districts) {
    const centre = centres.get(district);
    const shops = await prisma.user.findMany({
      where: { role: 'SHOP', districtName: district },
      orderBy: { id: 'asc' }
    });

    for (const [i, shop] of shops.entries()) {
      const [northKm, eastKm] = SPREAD[i % SPREAD.length];
      await prisma.user.update({
        where: { id: shop.id },
        data: {
          ...offset(centre.lat, centre.lng, northKm, eastKm),
          isOpen: true,
          serviceRadiusKm: shop.serviceRadiusKm ?? 5
        }
      });
    }
    placed += shops.length;
    console.log(`[demo:geo] ${district}: ${shops.length} shop(s) placed and opened`);
  }
  console.log(`[demo:geo] ${placed} shop(s) placed in total`);

  // 3 — stock every shelf. `sellableQty()` is what the customer sees, and it
  // applies the shop's safety buffer, so 40 units shows as ~36 rather than 40.
  const products = await prisma.product.findMany();
  if (products.length === 0) {
    console.log('[demo:geo] ⚠️  no products exist — run `npm run prisma:seed` first');
  }

  const allShops = await prisma.user.findMany({ where: { role: 'SHOP' }, orderBy: { id: 'asc' } });
  let stocked = 0;
  for (const shop of allShops) {
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

  // 4 — riders on shift, **in each district**, with a position.
  //
  // Without this every shop is filtered out of serviceability and the app says
  // NO_RIDER, which is a different empty screen from NO_SHOP and is the one
  // people misread as a bug. Per district, because a rider standing in Kochi
  // does nothing for a Kozhikode order: `freeRidersNear` is a radius around the
  // *pickup*, so one district's fleet cannot cover the other's shops.
  let onShift = 0;
  for (const district of districts) {
    const centre = centres.get(district);
    const riders = await prisma.user.findMany({
      where: {
        role: 'EXECUTIVE',
        executiveType: 'DELIVERY',
        employerShopId: null,
        districtName: district
      },
      take: 3,
      orderBy: { id: 'asc' }
    });

    for (const [i, rider] of riders.entries()) {
      const at = offset(centre.lat, centre.lng, i * 0.3, i * 0.2);
      await prisma.user.update({
        where: { id: rider.id },
        data: {
          isOnShift: true,
          isActive: true,
          lastLat: at.latitude,
          lastLng: at.longitude,
          lastLocationAt: new Date()
        }
      });
    }
    onShift += riders.length;
    console.log(`[demo:geo] ${district}: ${riders.length} rider(s) on shift`);

    if (riders.length === 0) {
      // Worth shouting about: shops in this district will be found and then
      // filtered out with NO_RIDER, which reads as a broken app.
      console.log(`[demo:geo] ⚠️  ${district} has no platform riders — its shops will show NO_RIDER`);
    }
  }
  console.log(`[demo:geo] ${onShift} rider(s) on shift in total`);

  console.log('[demo:geo] done. The Customer app should now find shops in both districts.');
  console.log('[demo:geo] Remember: `npm run server` AND `npm run sweeper` both have to be running.');
}

main()
  .catch((err) => {
    console.error('[demo:geo] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
