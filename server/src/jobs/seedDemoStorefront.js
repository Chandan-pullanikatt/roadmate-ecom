// Make the Customer app look like a storefront instead of a list.
// `npm run demo:storefront -- [lat] [lng]`
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
//
// `demo:geo` fixed the four conditions that make the app *find* anything: a shop
// in range, open, holding stock, with a rider on shift. It succeeded, and what it
// revealed is a second, entirely separate emptiness — the platform had **no
// merchandising data at all**:
//
//     categories 0 · banners 0 · collections 0 · industry icons 0 · shop ratings null
//
// Every one of those has had a model and (since PHASE B) an API for months.
// Nobody had ever created a row, so every screen fell through to its empty
// state simultaneously, and the result reads as an unfinished app rather than an
// unpopulated one. A demo cannot show a shop front that has nothing in it.
//
// It also fixes the thing that makes a client tap away in the first ten seconds:
// **`prisma/seed.js` puts every shop in Automobile**, so six of the seven tiles
// on the rail answer "not here yet". This script gives the other industries real
// shops, real products and real shelves around the same point.
//
// ── WHAT IT IS AND IS NOT ─────────────────────────────────────────────────────
//
// Dev/demo only, exactly like `demo:geo`, and **idempotent**: every row is keyed
// (a slug, a deterministic email, a title) and re-running updates rather than
// duplicating. It never deletes anything it did not create, and it touches no
// order, payment, settlement or invoice — nothing here is money.
//
// ⚠️ It does **not** upload any image anywhere, and that is deliberate. Icons and
// banner artwork are optional by design: the app ships its own artwork for every
// industry and category it knows (`apps/consumer/src/art.js`) and a banner is a
// composed card (theme + title + subtitle + CTA), so a demo looks finished with
// an empty Cloudinary account. The Master dashboard is where a real photograph
// replaces any of it, which is the half the client asked to see working.
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { BANNER_THEMES } from '../controllers/merchandisingController.js';

dotenv.config();

// Kochi (Ernakulam), near Marine Drive — the same default `demo:geo` uses, so
// running the two in either order lands on one demo world.
const DEFAULT_LAT = 9.9816;
const DEFAULT_LNG = 76.2999;

/** Roughly `km` north/east of a point. Good enough for a demo, not for routing. */
const offset = (lat, lng, northKm, eastKm) => ({
  latitude: lat + northKm / 111,
  longitude: lng + eastKm / (111 * Math.cos((lat * Math.PI) / 180))
});

/**
 * The demo world, by industry slug.
 *
 * Slugs are `prisma/seed.js`'s, not the design's labels — "groceries", not
 * "Grocery"; "textiles", not "Fashion". The app maps a slug to a short display
 * label and its artwork (`apps/consumer/src/art.js`), which is why nothing here
 * renames an industry row: a `name` is referenced by seven dashboards and by
 * every partner filed under it, and changing one to make a tile fit is the kind
 * of cosmetic edit that turns up later as a broken join.
 *
 * `categories` are the design's second rail. `shops` are real `User` rows with
 * real coordinates. `products` get filed into a category by index.
 */
const WORLD = {
  automobile: {
    order: 0,
    categories: ['Oil & Lubes', 'Auto Care', 'Spares & Fitments', 'Tyres & Wheels', 'Accessories'],
    shops: ['Auto World', 'Speed Motors Garage', 'Kerala Auto Spares'],
    // [name, brand, ₹price, category index]
    products: [
      ['TVS Chain Lube 2.0', 'TVS', 310, 0],
      ['Motul C2 Chain Lube', 'Motul', 340, 0],
      ['Shell Advance 10W-40 (1L)', 'Shell', 520, 0],
      ['Microfibre Wash Mitt', '3M', 249, 1],
      ['Dashboard Polish 250ml', '3M', 199, 1],
      ['Ceramic Brake Pads (Front)', 'Bosch', 1450, 2],
      ['Air Filter — Hatchback', 'Bosch', 640, 2],
      ['Tubeless Tyre 90/90-17', 'MRF', 2100, 3],
      ['LED Fog Lamp Pair', 'Philips', 1290, 4]
    ]
  },
  groceries: {
    order: 1,
    categories: ['Fruits & Vegetables', 'Dairy & Bakery', 'Snacks', 'Staples', 'Beverages'],
    shops: ['Lulu Fresh', 'Green Basket Supermarket', 'Daily Needs Mart'],
    products: [
      ['Bananas — Nendran (1 kg)', 'Farm Fresh', 65, 0],
      ['Tomatoes (500 g)', 'Farm Fresh', 32, 0],
      ['Onions (1 kg)', 'Farm Fresh', 48, 0],
      ['Amul Milk 500 ml', 'Amul', 28, 1],
      ['Brown Bread 400 g', 'Modern', 45, 1],
      ["Lay's Classic Salted (52 g)", "Lay's", 20, 2],
      ['Cadbury Hot Chocolate 200 g', 'Cadbury', 227, 2],
      ['Basmati Rice 5 kg', 'India Gate', 640, 3],
      ['Tea Dust 500 g', 'Kannan Devan', 285, 4]
    ]
  },
  restaurant: {
    order: 2,
    categories: ['Biryani', 'Burgers', 'Pizza', 'Bakery & Dairy', 'Beverages'],
    shops: ['Kuttichira Biryani Center', 'Paragon Restaurant', 'Calicut Kitchen'],
    products: [
      ['Beef Biryani', 'Kuttichira', 125, 0],
      ['Chicken Biryani', 'Kuttichira', 145, 0],
      ['Mutton Biryani', 'Kuttichira', 220, 0],
      ['Chicken Burger', 'Grill House', 119, 1],
      ['Veg Burger', 'Grill House', 89, 1],
      ['Farmhouse Pizza (Medium)', 'Napoli', 349, 2],
      ['Butterscotch Pastry', 'Sweet Corner', 60, 3],
      ['Fresh Lime Soda', 'House', 45, 4]
    ]
  },
  electronics: {
    order: 3,
    categories: ['Smartphones', 'Laptops', 'Earbuds & Headsets', 'Power Banks', 'Home Appliances'],
    shops: ['MyG Digital', 'Cosmos Electronics', 'Nandilath G-Mart'],
    products: [
      ['Redmi Note 14 (6/128)', 'Xiaomi', 15999, 0],
      ['Galaxy M15 5G', 'Samsung', 13499, 0],
      ['HP 15s Laptop (i5)', 'HP', 54990, 1],
      ['boAt Airdopes 141', 'boAt', 1299, 2],
      ['Sony WH-CH520', 'Sony', 4490, 2],
      ['Mi Power Bank 20000 mAh', 'Xiaomi', 1999, 3],
      ['Mixer Grinder 750 W', 'Preethi', 4250, 4]
    ]
  },
  textiles: {
    order: 4,
    categories: ['Men', 'Women', 'Kids', 'Footwear', 'Accessories'],
    shops: ['Lulu Fashion', 'Kalyan Silks', 'Trends Kozhikode'],
    products: [
      ['Cotton Casual Shirt', 'Peter England', 1299, 0],
      ['Slim Fit Denim', 'Levi’s', 2199, 0],
      ['Kurti — Printed Cotton', 'Biba', 1099, 1],
      ['Cotton Saree — Kasavu', 'Kalyan', 2499, 1],
      ['Kids T-Shirt (Pack of 2)', 'Max', 599, 2],
      ['Running Shoes', 'Campus', 1499, 3],
      ['Leather Belt', 'Hidesign', 899, 4]
    ]
  },
  sports: {
    order: 5,
    categories: ['Fitness', 'Cricket', 'Football', 'Cycling', 'Nutrition'],
    shops: ['Decathlon Kozhikode', 'Sports Junction', 'Fit Point Store'],
    products: [
      ['Yoga Mat 6 mm', 'Domyos', 899, 0],
      ['Adjustable Dumbbell 10 kg', 'Domyos', 2499, 0],
      ['Cricket Bat — Kashmir Willow', 'SG', 1899, 1],
      ['Football Size 5', 'Nivia', 749, 2],
      ['Cycling Helmet', 'Btwin', 1299, 3],
      ['Whey Protein 1 kg', 'MuscleBlaze', 2299, 4]
    ]
  }
};

/**
 * The promotional strip, by industry slug. `null` is the platform-wide banner —
 * the one that shows on every tile's home screen.
 *
 * Every one of these is a **composed card**: a theme, a headline, a sub and a
 * button, with no artwork. That is the point of the 2026-08-10 banner change and
 * the reason this seed needs no Cloudinary account. Uploading a photograph on
 * top of any of them is one field on the Master dashboard.
 */
const BANNERS = [
  {
    slug: 'automobile',
    title: 'Get 20% OFF on Auto Essentials',
    subtitle: 'Shop premium automobile products at 20% off',
    theme: 'sky',
    ctaLabel: 'Order Now',
    sortOrder: 0
  },
  {
    slug: 'groceries',
    title: 'Get items for just ₹9',
    subtitle: 'Spend ₹199 or more and unlock selected items for ₹9',
    theme: 'mint',
    ctaLabel: 'View all items',
    sortOrder: 0
  },
  {
    slug: 'restaurant',
    title: 'Get 20% OFF at Paragon',
    subtitle: 'Order delicious meals directly to your room',
    theme: 'blush',
    ctaLabel: 'Order Now',
    sortOrder: 0
  },
  {
    slug: 'electronics',
    title: 'Get 20% OFF on Electronics',
    subtitle: 'Shop the latest gadgets at 20% off',
    theme: 'lilac',
    ctaLabel: 'Order Now',
    sortOrder: 0
  },
  {
    slug: 'textiles',
    title: 'Buy one jacket, get the second at 50% off',
    subtitle: 'Buy one, get one — this week only',
    theme: 'ink',
    ctaLabel: 'Order Now',
    sortOrder: 0
  },
  {
    slug: 'sports',
    title: 'Gear up for the season',
    subtitle: 'Flat 15% off on fitness and cycling',
    theme: 'mint',
    ctaLabel: 'Order Now',
    sortOrder: 0
  },
  {
    slug: null,
    title: 'Free delivery above ₹199',
    subtitle: 'On every order, from every shop on RoadMate',
    theme: 'sunrise',
    // No CTA on purpose: this is an announcement, not an advert. A button that
    // goes nowhere is worse than no button — see the schema note on `ctaLabel`.
    ctaLabel: null,
    sortOrder: 10
  }
];

/** Spread shops around the centre so distance ranking is visible on screen. */
const SPREAD = [
  [0.5, 0.4], [-0.7, 0.6], [1.0, -0.5], [-0.4, -0.9], [1.3, 1.0],
  [-1.2, 0.3], [0.3, 1.5], [-1.0, -1.3], [1.6, -0.8], [-1.5, 1.2],
  [0.8, -1.6], [-0.2, 1.1], [1.1, 0.7], [-1.3, -0.4], [0.6, -0.9],
  [-0.8, 1.4], [1.4, 0.2], [-0.5, -1.5]
];

const RATINGS = [4.5, 4.2, 4.7, 4.0, 4.4, 4.8, 4.1, 4.6, 4.3];

/** "Oil & Lubes" → "oil-lubes". Same rule the taxonomy controller uses. */
const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function main() {
  const [latArg, lngArg] = process.argv.slice(2);

  // Default to wherever the demo world already is, not to Kochi: if `demo:geo`
  // has run against the client's actual coordinates, silently re-centring on
  // Marine Drive would move every shop 500 km and empty the app — which is the
  // exact failure `demo:geo` exists to prevent.
  let lat = latArg ? Number.parseFloat(latArg) : null;
  let lng = lngArg ? Number.parseFloat(lngArg) : null;

  // ── Where each district's storefront goes ─────────────────────────────────
  //
  // ⚠️ **This used to average the coordinates of every placed shop.** With one
  // district that was right; with two 180 km apart (Kochi and Kozhikode, since
  // 2026-08-11) the mean of the two is in the Arabian Sea, and every industry
  // shop this script creates would have been dropped there — found by nobody,
  // in neither district, with the demo simply looking empty.
  //
  // So the centre is computed **per district**, from that district's own shops,
  // and the whole storefront is built once per district. A customer in Kochi and
  // a customer in Kozhikode each get all seven industries near them, which is
  // what "both districts work" has to mean.
  const districtRows = await prisma.user.groupBy({
    by: ['districtName'],
    where: { role: 'SHOP', districtName: { not: null }, latitude: { not: null } },
    _avg: { latitude: true, longitude: true },
    _count: { _all: true }
  });

  /** @type {Array<{district: string|null, region: string|null, lat: number, lng: number}>} */
  let targets = [];

  if (lat != null && lng != null) {
    // An explicit point overrides everything: one storefront, where you are.
    targets = [{ district: districtRows[0]?.districtName ?? null, region: null, lat, lng }];
  } else if (districtRows.length) {
    targets = districtRows.map((row) => ({
      district: row.districtName,
      region: null,
      lat: row._avg.latitude,
      lng: row._avg.longitude
    }));
    for (const t of targets) {
      console.log(`[demo:storefront] ${t.district}: centring on ${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}`);
    }
  } else {
    targets = [{ district: null, region: null, lat: DEFAULT_LAT, lng: DEFAULT_LNG }];
    console.log('[demo:storefront] ⚠️  no shop has coordinates yet — using Kochi.');
    console.log('[demo:storefront]     Run `npm run demo:geo` first, then re-run this.');
  }

  lat = targets[0].lat;
  lng = targets[0].lng;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    console.error('[demo:storefront] usage: npm run demo:storefront -- [lat] [lng]');
    process.exitCode = 1;
    return;
  }

  const industries = await prisma.industry.findMany();
  if (!industries.length) {
    console.error('[demo:storefront] no industries exist — run `npm run prisma:seed` first.');
    process.exitCode = 1;
    return;
  }
  const bySlug = new Map(industries.map((i) => [i.slug, i]));

  const passwordHash = await bcrypt.hash('password123', await bcrypt.genSalt(10));

  // A shop needs somewhere in the hierarchy to hang. Reuse whatever the seed
  // built rather than inventing a parallel chain — an orphan shop is invisible
  // to every partner dashboard, which is a confusing thing to hand a client.
  const regional = await prisma.user.findFirst({ where: { role: 'REGIONAL' }, orderBy: { id: 'asc' } });
  // One regional partner per district, so a Kozhikode storefront shop reports to
  // a Kozhikode partner. An orphan shop, or one parented into the wrong district,
  // is invisible on the dashboard of the person who is supposed to manage it.
  const regionalRows = await prisma.user.findMany({
    where: { role: 'REGIONAL', districtName: { not: null } },
    select: { id: true, districtName: true, regionName: true, stateName: true },
    orderBy: { id: 'asc' }
  });
  const regionalByDistrict = new Map();
  for (const r of regionalRows) if (!regionalByDistrict.has(r.districtName)) regionalByDistrict.set(r.districtName, r);
  // `Product.ownerId` is required and cascades on delete — a product belongs to
  // whoever sells it. No fallback to null: a demo that half-creates its
  // catalogue is worse than one that refuses and says why.
  const owner =
    (await prisma.user.findFirst({ where: { role: 'DISTRIBUTOR' }, orderBy: { id: 'asc' } })) ??
    (await prisma.user.findFirst({ where: { role: 'MASTER' } }));
  if (!owner) {
    console.error('[demo:storefront] no DISTRIBUTOR or MASTER to own the products — run `npm run prisma:seed` first.');
    process.exitCode = 1;
    return;
  }

  let spreadIndex = 0;
  let ratingIndex = 0;
  const counts = { industries: 0, categories: 0, shops: 0, products: 0, shelves: 0 };

  for (const [slug, plan] of Object.entries(WORLD)) {
    const industry = bySlug.get(slug);
    if (!industry) {
      console.log(`[demo:storefront] no "${slug}" industry in this database — skipping.`);
      continue;
    }

    // 1 — the rail's order. Editorial, and the reason `sortOrder` exists: the
    // alphabet putting Automobile first is an accident, not a decision.
    await prisma.industry.update({
      where: { id: industry.id },
      data: { sortOrder: plan.order, isActive: true }
    });
    counts.industries += 1;

    // 2 — the category rail. Keyed by `@@unique([industryId, slug])`, so this is
    // an upsert and re-running never duplicates.
    const categories = [];
    for (const [index, name] of plan.categories.entries()) {
      const category = await prisma.category.upsert({
        where: { industryId_slug: { industryId: industry.id, slug: slugify(name) } },
        update: { name, sortOrder: index },
        create: { name, slug: slugify(name), sortOrder: index, industryId: industry.id }
      });
      categories.push(category);
      counts.categories += 1;
    }

    // 3 — products. Keyed by name + industry, because `Product` has no natural
    // unique key and `prisma/seed.js` itself creates duplicate names.
    const products = [];
    for (const [name, brand, price, categoryIndex] of plan.products) {
      const existing = await prisma.product.findFirst({ where: { name, industryId: industry.id } });
      const data = {
        name,
        brand,
        price,
        // The struck-through price in the design (₹310.00 → ₹294.00). `mrp` has
        // been on `Product` since Phase 0 and `shelfItem` has always returned it;
        // no seeded product had ever set one, so every price on every screen
        // rendered bare. ~12% above, rounded to a whole rupee — a discount that
        // reads as real rather than as a placeholder 50% off everything.
        mrp: Math.round(price * 1.12),
        industryId: industry.id,
        categoryId: categories[categoryIndex]?.id ?? null
      };
      const product = existing
        ? await prisma.product.update({ where: { id: existing.id }, data })
        : await prisma.product.create({
            data: {
              ...data,
              sku: `${slug.slice(0, 3).toUpperCase()}-${slugify(name).slice(0, 18).toUpperCase()}`,
              ownerId: owner.id,
              stockLevel: 100
            }
          });
      products.push(product);
      counts.products += 1;
    }

    // 4 — shops, **once per district** (2026-08-11). Deterministic emails make
    // this an upsert; a demo re-run must not leave three "Auto World"s ranked
    // against each other. The district is part of the email for the same reason:
    // without it the second district's upsert would *move* the first district's
    // shop rather than create its own, and Kochi would quietly lose its
    // storefront the moment Kozhikode was seeded.
    for (const target of targets) {
    for (const [index, name] of plan.shops.entries()) {
      const dslug = target.district ? slugify(target.district) : 'demo';
      const email = `demo.${slug}.${dslug}.${index + 1}@roadmate.demo`;
      const [northKm, eastKm] = SPREAD[spreadIndex % SPREAD.length];
      spreadIndex += 1;
      const rating = RATINGS[ratingIndex % RATINGS.length];
      ratingIndex += 1;

      const presentation = {
        name,
        businessName: name,
        role: 'SHOP',
        isActive: true,
        isOpen: true,
        industryId: industry.id,
        rating,
        openTime: '09:00',
        closeTime: '22:00',
        serviceRadiusKm: 6,
        safetyStockBuffer: 90,
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
          // ⚠️ Read from the data, never typed. This said `districtName:
          // 'Ernakulam'` while the seed said 'Kochi' — a one-word mismatch that
          // does not error: it puts the shop in a district no partner covers, so
          // it is invisible to every partner dashboard and to the approval
          // queries, which match this string exactly (see `geoController.js`).
          stateName: regionalByDistrict.get(target.district)?.stateName ?? 'Kerala',
          districtName: target.district,
          regionName: regionalByDistrict.get(target.district)?.regionName ?? null,
          // Hang off a regional partner **in this district**, not just any one.
          parentId: regionalByDistrict.get(target.district)?.id ?? regional?.id ?? null
        }
      });
      counts.shops += 1;

      // 5 — the shelf. Without this the shop is ranked and then filtered out of
      // every product search, which looks like the catalogue is broken.
      for (const [i, product] of products.entries()) {
        const existing = await prisma.shopInventory.findFirst({
          where: { shopId: shop.id, productId: product.id, variantId: null }
        });
        // Deliberately uneven, and one line deliberately low: "only 3 left"
        // under five units is a real behaviour worth showing a client.
        const quantity = [40, 25, 12, 3, 60, 18][(i + index) % 6];
        if (existing) {
          await prisma.shopInventory.update({
            where: { id: existing.id },
            data: { quantity, sellingPrice: product.price, isAvailable: true }
          });
        } else {
          await prisma.shopInventory.create({
            data: {
              shopId: shop.id,
              productId: product.id,
              quantity,
              sellingPrice: product.price,
              isAvailable: true
            }
          });
        }
        counts.shelves += 1;
      }
    }
    }
  }

  // 6 — the shops `prisma/seed.js` made have no rating, so every card in the
  // design's Popular Shops list rendered without its star. Fill the gap without
  // touching anything else about them.
  const unrated = await prisma.user.findMany({
    where: { role: 'SHOP', rating: null },
    select: { id: true }
  });
  for (const [i, shop] of unrated.entries()) {
    await prisma.user.update({
      where: { id: shop.id },
      data: {
        rating: RATINGS[i % RATINGS.length],
        openTime: '09:00',
        closeTime: '22:00'
      }
    });
  }

  // 7 — banners. Keyed by title, and given a wide window so a demo three months
  // from now still has a shop front. They are live from a day ago rather than
  // from `now`, because a `validFrom` in the future by even a second is a banner
  // the customer endpoint correctly refuses to return — which would look like
  // the seed had silently failed.
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  let bannerCount = 0;

  for (const banner of BANNERS) {
    const industry = banner.slug ? bySlug.get(banner.slug) : null;
    if (banner.slug && !industry) continue;
    if (!BANNER_THEMES.includes(banner.theme)) {
      // A guard rather than a comment: this array and the controller's whitelist
      // are one thing in two files, and a typo here would seed a banner the API
      // itself would reject on edit.
      console.log(`[demo:storefront] ⚠️  unknown theme "${banner.theme}" — skipping "${banner.title}"`);
      continue;
    }

    const data = {
      title: banner.title,
      subtitle: banner.subtitle,
      theme: banner.theme,
      ctaLabel: banner.ctaLabel ?? null,
      imageUrl: null,
      validFrom: from,
      validTo: to,
      isActive: true,
      sortOrder: banner.sortOrder,
      industryId: industry?.id ?? null
    };

    const existing = await prisma.banner.findFirst({ where: { title: banner.title } });
    if (existing) await prisma.banner.update({ where: { id: existing.id }, data });
    else await prisma.banner.create({ data });
    bannerCount += 1;
  }

  // 8 — collections. Curation only: no price, no discount, no settlement (the
  // whole difference between this and a coupon). Built from what actually exists
  // rather than from a fixed list, so it is never a heading with nothing under it.
  const cheap = await prisma.product.findMany({
    where: { price: { lte: 99 } },
    orderBy: { price: 'asc' },
    take: 12
  });
  const popular = await prisma.product.findMany({ orderBy: { id: 'desc' }, take: 10 });

  const collections = [
    { slug: 'items-under-99', title: 'Items under ₹99', subtitle: 'Small basket, big savings', products: cheap, sortOrder: 0 },
    { slug: 'bestsellers', title: 'Popular right now', subtitle: 'What people near you are buying', products: popular, sortOrder: 1 }
  ];

  let collectionCount = 0;
  for (const c of collections) {
    if (!c.products.length) continue;
    const collection = await prisma.collection.upsert({
      where: { slug: c.slug },
      update: { title: c.title, subtitle: c.subtitle, isActive: true, sortOrder: c.sortOrder },
      create: { slug: c.slug, title: c.title, subtitle: c.subtitle, sortOrder: c.sortOrder }
    });
    // Whole-list replace, the same shape `setCollectionItems` uses: order is the
    // content, so half-updating it is not a smaller version of updating it.
    await prisma.$transaction([
      prisma.collectionItem.deleteMany({ where: { collectionId: collection.id } }),
      prisma.collectionItem.createMany({
        data: c.products.map((p, index) => ({ collectionId: collection.id, productId: p.id, position: index }))
      })
    ]);
    collectionCount += 1;
  }

  // 9 — riders. Serviceability is four conditions and this is the one that is
  // invisible: without a rider on shift in range, every shop above is filtered
  // out and the app answers NO_RIDER. `demo:geo` does this too; doing it here as
  // well means either script alone leaves a working demo.
  const riders = await prisma.user.findMany({
    where: { role: 'EXECUTIVE', executiveType: 'DELIVERY', employerShopId: null },
    take: 4,
    orderBy: { id: 'asc' }
  });
  for (const [i, rider] of riders.entries()) {
    const at = offset(lat, lng, i * 0.3 - 0.3, i * 0.25 - 0.2);
    await prisma.user.update({
      where: { id: rider.id },
      data: {
        isActive: true,
        isOnShift: true,
        lastLat: at.latitude,
        lastLng: at.longitude,
        lastLocationAt: new Date()
      }
    });
  }

  console.log('[demo:storefront] done.');
  console.log(`  industries ordered : ${counts.industries}`);
  console.log(`  categories         : ${counts.categories}`);
  console.log(`  demo shops         : ${counts.shops}`);
  console.log(`  products           : ${counts.products}`);
  console.log(`  shelf rows         : ${counts.shelves}`);
  console.log(`  shops given a star : ${unrated.length}`);
  console.log(`  banners            : ${bannerCount}`);
  console.log(`  collections        : ${collectionCount}`);
  console.log(`  riders on shift    : ${riders.length}`);
  console.log('');
  console.log('  Every industry tile now opens a real storefront. `npm run server` AND');
  console.log('  `npm run sweeper` both have to be running for an order to move.');
}

main()
  .catch((err) => {
    console.error('[demo:storefront] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
