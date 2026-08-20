// Dev only. Put a working delivery address on a customer's account.
//
//     npm run demo:address -- 9876543210
//     npm run demo:address -- 9876543210 "Marine Drive"
//     npm run demo:address                 (every customer who has none)
//
// WHY THIS EXISTS. The Customer app takes a delivery pin from the **device's
// GPS and nothing else** (`apps/consumer/app/addresses.js` — there is no typed
// lat/lng and no draggable map, both on purpose). That is right for a real
// customer standing at their own door, and useless for a demo: you cannot send
// somebody an address, because the app has nowhere to type one. A client sitting
// 500 km from where `demo:geo` put the world drops a pin, gets "we don't deliver
// here yet", and concludes the app is broken.
//
// A **saved** address has no such problem. The app lists whatever the server
// says the customer has saved and lets them pick one, and serviceability is
// computed against the picked address rather than the phone's position
// (`apps/consumer/src/place.js` — "the point is the delivery address, never the
// phone's position"). So this writes the address the demo needs straight onto
// the account, and the client just taps it.
//
// ⚠️ **The coordinates are read from the data, never typed here.** The whole
// failure this script exists to prevent is an address in the wrong place, and a
// hardcoded "Kochi = 9.98, 76.30" would reintroduce it the first time somebody
// runs `demo:geo` against a venue's real coordinates. Instead it finds where the
// shops actually are — the densest cluster of them — and drops the address in
// the middle of it. Wherever the world is, the address lands in it.
//
// It prints the coordinates it used, so they can be shared with whoever is
// running the demo.
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';
import { haversineKm } from '../lib/geo.js';

dotenv.config();

/**
 * The point with the most shops within `serviceRadiusKm` of it.
 *
 * Not the mean of every shop: with two districts 180 km apart (Kochi and
 * Kozhikode) the mean is in the Arabian Sea, which is the exact bug
 * `demo:storefront` had to fix once already. Each shop is scored by how many
 * other shops it can see, and the winner's neighbourhood centre is the answer —
 * so the address lands in whichever district has the most to show.
 */
async function bestPoint(districtFilter) {
  const shops = await prisma.user.findMany({
    where: {
      role: 'SHOP',
      isActive: true,
      latitude: { not: null },
      longitude: { not: null },
      ...(districtFilter ? { districtName: districtFilter } : {})
    },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      districtName: true,
      serviceRadiusKm: true
    }
  });

  if (shops.length === 0) return null;

  let best = null;
  for (const anchor of shops) {
    // Who would serve somebody standing on this shop: in range, by that shop's
    // own radius. This is the same question `shopRanking` asks, which is what
    // makes the winner a point the app will actually answer for.
    const inRange = shops.filter(
      (s) =>
        haversineKm(anchor.latitude, anchor.longitude, s.latitude, s.longitude) <=
        (s.serviceRadiusKm ?? 5)
    );
    if (!best || inRange.length > best.count) {
      const lat = inRange.reduce((sum, s) => sum + s.latitude, 0) / inRange.length;
      const lng = inRange.reduce((sum, s) => sum + s.longitude, 0) / inRange.length;
      best = { count: inRange.length, lat, lng, district: anchor.districtName };
    }
  }
  return best;
}

async function main() {
  const [phoneArg, labelArg] = process.argv.slice(2);

  const point = await bestPoint(null);
  if (!point) {
    console.error('[demo:address] no shop has coordinates yet.');
    console.error('[demo:address] run `npm run prisma:seed`, then `npm run demo:geo`, then this.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `[demo:address] the busiest point in the demo world is ${point.lat.toFixed(6)}, ` +
      `${point.lng.toFixed(6)} (${point.district ?? 'no district'}) — ${point.count} shop(s) in range.`
  );

  // Who gets it. A named phone creates the customer if they have never signed
  // in, so the address is waiting *before* the client's first sign-in rather
  // than needing a second run afterwards.
  let customers;
  if (phoneArg) {
    const phone = String(phoneArg).replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      console.error('[demo:address] usage: npm run demo:address -- <10-digit phone> [label]');
      process.exitCode = 1;
      return;
    }
    customers = [
      await prisma.customer.upsert({
        where: { phone },
        update: {},
        create: { phone }
      })
    ];
  } else {
    // Everybody who cannot order because they have nowhere to send it.
    customers = await prisma.customer.findMany({
      where: { addresses: { none: {} } },
      take: 200
    });
    console.log(`[demo:address] no phone given — filling in ${customers.length} customer(s) with no address.`);
  }

  const label = labelArg || 'Demo location';
  let written = 0;

  for (const customer of customers) {
    const existing = await prisma.address.findFirst({
      where: { customerId: customer.id, label }
    });

    const data = {
      label,
      line1: 'RoadMate demo address',
      line2: point.district ?? null,
      city: point.district ?? 'Kochi',
      latitude: point.lat,
      longitude: point.lng,
      // Selected by default, so the client does not have to find it. The app
      // falls back to the device fix only when no address is chosen.
      isDefault: true
    };

    if (existing) {
      await prisma.address.update({ where: { id: existing.id }, data });
    } else {
      // One default per customer, or the app has two answers to "where is this
      // going" and picks whichever came back first.
      await prisma.address.updateMany({
        where: { customerId: customer.id, isDefault: true },
        data: { isDefault: false }
      });
      await prisma.address.create({ data: { ...data, customerId: customer.id } });
    }
    written += 1;
  }

  console.log(`[demo:address] ${written} address(es) written, labelled "${label}".`);
  console.log('[demo:address] The client signs in, and it is already there and already selected.');
}

main()
  .catch((err) => {
    console.error('[demo:address] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
