// Dev only. The two industries the client asked for and the seed never made.
//
//     npm run demo:bookings
//
// WHY THIS EXISTS. `prisma/seed.js` creates six industries — automobile,
// groceries, restaurant, electronics, textiles, sports — and HANDOFF §1 promises
// seven, of which **gym is not one of the six**. Turf was never anywhere: it
// needed `SERVICE_BOOKING`, which had no code path until now. So the two things
// the client most wants to see were, between them, missing an industry row, a
// catalogue, a venue, a shelf and a calendar. This script makes all five.
//
// It is the third of the demo trio and it runs last:
//
//     npm run demo:geo         → puts the world where the demo is happening
//     npm run demo:storefront  → makes the existing six industries look like shops
//     npm run demo:bookings    → adds gym and turf, per district
//
// WHAT IT DOES NOT DO, and this is the important sentence: **it cannot make
// either of them buyable.** Both `NO_DELIVERY` and `SERVICE_BOOKING` are
// prepaid-only on the server, deliberately (see `lib/fulfilment.js`
// `isPrepaidOnly` — cash at the venue's own gate is money the platform never
// holds but would still book commission on). With no Razorpay keys the apps say
// so plainly on the home screen rather than walking somebody into a 422. The
// fix is three environment variables, and Razorpay's **test** keys are free and
// instant at signup. Everything else in the flow — browse, pick an hour, the
// venue's calendar, the code at the gate — works today.
//
// Idempotent: deterministic emails and a unique slot window mean a re-run
// updates rather than duplicates.
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';

dotenv.config();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Roughly `km` north/east of a point. Good enough for a demo, not for routing. */
const offset = (lat, lng, northKm, eastKm) => ({
  latitude: lat + northKm / 111,
  longitude: lng + eastKm / (111 * Math.cos((lat * Math.PI) / 180))
});

// Spread venues around the district centre rather than stacking them — the app
// sorts by distance and shows "1.2 km", and a dozen pins on one spot looks fake.
const SPREAD = [[0.5, 0.4], [-0.7, 0.6], [1.0, -0.5], [-0.4, -0.9], [1.3, 1.0], [-1.2, 0.3]];

/**
 * The two worlds.
 *
 * `fulfilmentType` is the whole difference between them. A gym sells a duration
 * (`validityDays` on the variant, which is what the voucher's window is built
 * from); a turf sells an hour (a `ServiceSlot`, which *is* the voucher's window).
 */
const WORLD = {
  gym: {
    name: 'Gym & Fitness',
    fulfilmentType: 'NO_DELIVERY',
    sortOrder: 6,
    categories: ['Memberships', 'Personal Training', 'Day Passes'],
    shops: ['Iron House Fitness', 'Pulse Gym & Spa', 'Kettlebell Club'],
    // [name, brand, price, categoryIndex, variants]
    products: [
      ['Gym Membership', 'Iron House', 1500, 0, [
        ['1 Month', 1500, 30],
        ['3 Months', 4000, 90],
        ['Annual', 12000, 365]
      ]],
      ['Personal Training Pack', 'Iron House', 6000, 1, [
        ['8 Sessions', 6000, 60],
        ['16 Sessions', 11000, 120]
      ]],
      ['Day Pass', 'Iron House', 250, 2, [['Single Day', 250, 1]]]
    ]
  },
  turf: {
    name: 'Turf & Courts',
    fulfilmentType: 'SERVICE_BOOKING',
    sortOrder: 7,
    categories: ['Football Turf', 'Cricket Nets', 'Badminton'],
    shops: ['Green Arena Turf', 'Kickoff Sports Arena', 'Smash Badminton Court'],
    products: [
      ['5-a-side Football Pitch', 'Green Arena', 900, 0, []],
      ['7-a-side Football Pitch', 'Green Arena', 1400, 0, []],
      ['Cricket Net', 'Green Arena', 600, 1, []],
      ['Badminton Court', 'Green Arena', 400, 2, []]
    ]
  }
};

/**
 * The calendar a turf opens: the next 7 days, 6am to 11pm, hour slots.
 *
 * Evening hours are priced up and given the scarcity that makes the picker worth
 * looking at — some full, some with one place left. A calendar where every hour
 * is identical and free demonstrates nothing, and "6–7pm is gone" is exactly the
 * behaviour a turf owner will want to see working.
 */
const DAYS_AHEAD = 7;
const OPEN_HOUR = 6;
const CLOSE_HOUR = 23;
const EVENING_FROM = 17; // 5pm — when a pitch stops being cheap

async function main() {
  const districtRows = await prisma.user.groupBy({
    by: ['districtName'],
    where: { role: 'SHOP', districtName: { not: null }, latitude: { not: null } },
    _avg: { latitude: true, longitude: true }
  });

  if (!districtRows.length) {
    console.error('[demo:bookings] no shop has coordinates yet.');
    console.error('[demo:bookings] run `npm run prisma:seed`, then `npm run demo:geo`, then this.');
    process.exitCode = 1;
    return;
  }

  const targets = districtRows.map((row) => ({
    district: row.districtName,
    lat: row._avg.latitude,
    lng: row._avg.longitude
  }));
  for (const t of targets) {
    console.log(`[demo:bookings] ${t.district}: centring on ${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}`);
  }

  const passwordHash = await bcrypt.hash('password123', await bcrypt.genSalt(10));

  // Hang the new venues off whatever hierarchy the seed already built. An orphan
  // shop is invisible to every partner dashboard, which is a confusing thing to
  // hand a client halfway through a demo.
  const master = await prisma.user.findFirst({ where: { role: 'MASTER' } });
  if (!master) {
    console.error('[demo:bookings] no MASTER user — run `npm run prisma:seed` first.');
    process.exitCode = 1;
    return;
  }
  const regionals = await prisma.user.findMany({ where: { role: 'REGIONAL' } });
  const regionalByDistrict = new Map(regionals.map((r) => [r.districtName, r]));

  const counts = { industries: 0, products: 0, variants: 0, shops: 0, shelves: 0, slots: 0 };
  let spreadIndex = 0;

  for (const [slug, plan] of Object.entries(WORLD)) {
    // 1 — the industry. `fulfilmentType` is the switch everything downstream
    // reads, so an existing row is corrected rather than left alone: a `gym`
    // industry sitting at the PICK_AND_DELIVER default would route memberships
    // to a rider.
    const industry = await prisma.industry.upsert({
      where: { slug },
      update: { name: plan.name, fulfilmentType: plan.fulfilmentType, sortOrder: plan.sortOrder, isActive: true },
      create: {
        slug,
        name: plan.name,
        fulfilmentType: plan.fulfilmentType,
        sortOrder: plan.sortOrder,
        isActive: true
      }
    });
    counts.industries += 1;

    // 2 — categories.
    const categories = [];
    for (const [index, name] of plan.categories.entries()) {
      categories.push(
        await prisma.category.upsert({
          where: { industryId_slug: { industryId: industry.id, slug: slugify(name) } },
          update: { name, sortOrder: index },
          create: { name, slug: slugify(name), sortOrder: index, industryId: industry.id }
        })
      );
    }

    // 3 — the catalogue, owned by the master like every other demo product.
    const products = [];
    for (const [name, brand, price, categoryIndex, variants] of plan.products) {
      const existing = await prisma.product.findFirst({ where: { name, industryId: industry.id } });
      const data = {
        name,
        brand,
        price,
        mrp: Math.round(price * 1.15),
        industryId: industry.id,
        categoryId: categories[categoryIndex]?.id ?? null
      };
      const product = existing
        ? await prisma.product.update({ where: { id: existing.id }, data })
        : await prisma.product.create({
            data: {
              ...data,
              sku: `${slug.slice(0, 3).toUpperCase()}-${slugify(name).slice(0, 18).toUpperCase()}`,
              ownerId: master.id,
              stockLevel: 100
            }
          });
      counts.products += 1;

      // The gym's variants carry `validityDays` — the shop setting price *and*
      // duration, which is the client's own answer (PLAN §7.4) and the reason
      // `voucher_validity_days` is only a fallback now.
      for (const [label, vPrice, validityDays] of variants) {
        await prisma.productVariant.upsert({
          where: { productId_label: { productId: product.id, label } },
          update: { price: vPrice, validityDays },
          create: { productId: product.id, label, price: vPrice, validityDays }
        });
        counts.variants += 1;
      }

      products.push(product);
    }

    // 4 — venues, once per district.
    for (const target of targets) {
      const dslug = slugify(target.district ?? 'demo');

      for (const [index, name] of plan.shops.entries()) {
        const email = `demo.${slug}.${dslug}.${index + 1}@roadmate.demo`;
        const [northKm, eastKm] = SPREAD[spreadIndex % SPREAD.length];
        spreadIndex += 1;

        const presentation = {
          name,
          businessName: name,
          role: 'SHOP',
          isActive: true,
          isOpen: true,
          industryId: industry.id,
          rating: [4.6, 4.3, 4.8][index % 3],
          openTime: '06:00',
          closeTime: '23:00',
          serviceRadiusKm: 6,
          safetyStockBuffer: 100, // nothing is physically shipped from either
          ...offset(target.lat, target.lng, northKm, eastKm)
        };

        const shop = await prisma.user.upsert({
          where: { email },
          update: presentation,
          create: {
            ...presentation,
            email,
            password: passwordHash,
            approvedAt: new Date(),
            country: 'India',
            stateName: regionalByDistrict.get(target.district)?.stateName ?? 'Kerala',
            districtName: target.district,
            regionName: regionalByDistrict.get(target.district)?.regionName ?? null,
            parentId: regionalByDistrict.get(target.district)?.id ?? null
          }
        });
        counts.shops += 1;

        // 5 — the shelf. For both of these it is a **price list, not a count**:
        // nothing is reserved and nothing is decremented (see `lib/voucher.js`).
        // It still has to exist, because it is what says this venue sells this
        // thing at this price, and a venue with an empty shelf is filtered out of
        // every catalogue query.
        for (const product of products) {
          const existing = await prisma.shopInventory.findFirst({
            where: { shopId: shop.id, productId: product.id, variantId: null }
          });
          const data = { quantity: 999, sellingPrice: product.price, isAvailable: true };
          if (existing) {
            await prisma.shopInventory.update({ where: { id: existing.id }, data });
          } else {
            await prisma.shopInventory.create({ data: { ...data, shopId: shop.id, productId: product.id } });
          }
          counts.shelves += 1;
        }

        // 6 — the calendar. Turf only: a gym membership has no hours.
        if (plan.fulfilmentType === 'SERVICE_BOOKING') {
          counts.slots += await openCalendar(shop, products);
        }
      }
    }
  }

  console.log(
    `[demo:bookings] ${counts.industries} industries · ${counts.products} products · ` +
      `${counts.variants} variants · ${counts.shops} venues · ${counts.shelves} shelf rows · ` +
      `${counts.slots} slots`
  );
  console.log('[demo:bookings] done. Gym and Turf now appear on the customer home rail.');
  console.log('[demo:bookings] ⚠️  Neither can be BOUGHT until Razorpay keys are set — both are');
  console.log('[demo:bookings]     prepaid-only by design. Test keys are free at razorpay.com.');
}

/**
 * Open a week of hours for every pitch this venue sells.
 *
 * Some hours are pre-booked so the picker has something to say. That is done by
 * writing `booked` directly rather than by placing orders: an order needs a
 * customer, a payment and a webhook, and a demo calendar that is 100% free
 * demonstrates neither the scarcity line ("Only 1 left") nor the greyed-out
 * "Booked" row — which are the two things that make the screen look real.
 */
async function openCalendar(shop, products) {
  const now = new Date();
  let made = 0;

  for (const product of products) {
    for (let day = 0; day < DAYS_AHEAD; day += 1) {
      const date = new Date(now.getTime() + day * DAY_MS);

      for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour += 1) {
        const startsAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
        if (startsAt <= now) continue;

        const evening = hour >= EVENING_FROM;
        const capacity = 2;
        // Evenings fill up; mornings do not. Deterministic rather than random so
        // a re-run does not reshuffle the calendar under a demo in progress.
        const booked = evening ? ((day + hour) % 3 === 0 ? 2 : (day + hour) % 3 === 1 ? 1 : 0) : 0;

        await prisma.serviceSlot.upsert({
          where: {
            shopId_productId_startsAt: { shopId: shop.id, productId: product.id, startsAt }
          },
          update: { capacity, booked, isOpen: true },
          create: {
            shopId: shop.id,
            productId: product.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + HOUR_MS),
            capacity,
            booked,
            // An evening pitch costs more. This is the whole reason
            // `priceOverride` exists, and it is worth a client seeing it.
            priceOverride: evening ? Math.round(Number(product.price) * 1.4) : null
          }
        });
        made += 1;
      }
    }
  }

  return made;
}

main()
  .catch((err) => {
    console.error('[demo:bookings] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
