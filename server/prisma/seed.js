import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/*
 * When the seeded partners were "approved".
 *
 * This script writes `isActive: true` directly rather than going through
 * `POST /api/partners/:id/approve`, so nothing ever stamps `approvedAt` — and
 * since 2026-08-09 that column is the start of the 3-month free trial and
 * therefore of the whole billing clock (HANDOFF §7ter). Without it every seeded
 * shop, distributor and manufacturer shows as "no start date" on the Master
 * billing screen and `npm run billing` invoices nobody, which makes the feature
 * impossible to demonstrate against a seeded database.
 *
 * Backdated four months on purpose: the trial is three, so a seeded partner is
 * **past** it and has one real invoice waiting. A seed that put everybody on
 * day one of a free trial would look identical to a seed that had not set the
 * date at all.
 */
const SEED_APPROVED_AT = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

/** Declared before GEOGRAPHY because the first region names them as its partner. */
const PRIMARY_REGIONAL_PARTNER = 'Anoop Varghese';

/**
 * Names for the seeded delivery partners, drawn in order.
 *
 * Riders used to be called "Panampilly Nagar Rider 1". A demo whose delivery
 * fleet is numbered placeholders undercuts every screen it appears on — and the
 * rider's name is on the customer's tracking screen, which is the screen the
 * client will look at longest.
 */
const RIDER_NAMES = [
  'Anish Thomas', 'Shameer Basheer', 'Jithin Raj', 'Noufal Ali', 'Arun Prasad',
  'Vivek Nair', 'Sudheer Kumar', 'Rejith Mohan', 'Firoz Khan', 'Manoj Pillai',
  'Sanoop Das', 'Hari Krishnan', 'Ajmal Salim', 'Deepak Menon', 'Tijo Jose',
  'Vishnu Prasad', 'Ramees Ahmed', 'Sibin Varghese', 'Nithin Babu', 'Akhil Raveendran'
];
let riderNameSeq = 0;
const nextRiderName = () => RIDER_NAMES[riderNameSeq++ % RIDER_NAMES.length];

/*
 * ── WHERE THE DEMO IS ───────────────────────────────────────────────────────
 *
 * **Kerala, Kochi and Kozhikode** (2026-08-11). This used to be Telangana /
 * Hyderabad District, spelled out in 32 separate string literals across this
 * file, with Telugu partner names and `TS` numberplates. The client is in
 * Kerala; a demo of a Kerala platform listing Banjara Hills garages run by
 * Venkata Rao is the kind of detail that makes everything else look like a
 * template.
 *
 * ⚠️ **One table, referenced everywhere.** The literals are gone on purpose: the
 * previous layout meant moving the demo was 32 edits with no way to tell you had
 * missed one — and a *missed* one is not a typo, it is a partner stranded in a
 * state nobody covers, invisible to the approval queues that match `stateName`
 * exactly (see `geoController.js`). Changing the demo's location is now this
 * constant and nothing else.
 *
 * The two districts are far apart on purpose — 180 km — because a single-city
 * demo cannot show that serviceability is per-shop-radius rather than national.
 * `npm run demo:geo` places each district's shops around its own centre, so a
 * customer in Kochi finds Kochi shops and a customer in Kozhikode finds
 * Kozhikode ones.
 *
 * ⚠️ `district` is what every approval query matches on, and what
 * `GET /api/geo/coverage` hands the Rider app's registration form. "Kochi" is
 * the client's word; the *revenue* district in Kerala's administration is
 * **Ernakulam**, of which Kochi is the city. If any of this is ever reconciled
 * with a government list, that is the row that will need changing.
 */
const GEOGRAPHY = Object.freeze({
  state: 'Kerala',
  // Names are Malayali, and the numberplate series are the real RTO codes for
  // each district — KL-07 Ernakulam/Kochi, KL-11 Kozhikode. Small things, but a
  // client reads their own state's plates at a glance.
  statePartner: 'Rajeev Menon',
  industryStatePartner: 'Suresh Nair',
  districts: [
    {
      name: 'Kochi',
      partner: 'Vinod Pillai',
      plate: 'KL07',
      // ⚠️ Every region carries a **named** partner and a **named** business.
      // They used to be generated — "Edappally Regional Partner" running
      // "Edappally Garage 1" — and a demo full of `${placeholder} ${index}` reads
      // as test data to the one audience whose confidence the demo exists to win.
      // Eight rows of real-sounding names cost nothing and are the difference.
      //
      // The first region is the "original" one the older parts of this seed hang
      // their shop, riders and orders off.
      regions: [
        { name: 'Marine Drive',     partner: PRIMARY_REGIONAL_PARTNER,
          shops: ['Marine Drive Auto Care', 'Ravipuram Motors'] },
        { name: 'Panampilly Nagar', partner: 'Deepa Krishnan',
          shops: ['Panampilly Motors', 'Atlantis Auto Spares'] },
        { name: 'Kakkanad',         partner: 'Sajan Joseph',
          shops: ['Kakkanad Tyre & Service', 'Infopark Car Care', 'Thrikkakara Auto Point'] },
        { name: 'Edappally',        partner: 'Rakesh Menon',
          shops: ['Edappally Auto Works', 'Lulu Junction Motors'] },
        { name: 'Vyttila',          partner: 'Nisha Abraham',
          shops: ['Vyttila Car Point', 'Hub Auto Garage', 'Kundannoor Tyres'] }
      ]
    },
    {
      name: 'Kozhikode',
      partner: 'Faisal Rahman',
      plate: 'KL11',
      regions: [
        { name: 'Mavoor Road',      partner: 'Ashraf Kunhi',
          shops: ['Mavoor Road Motors', 'Calicut Auto Spares'] },
        { name: 'Palayam',          partner: 'Bindu Nambiar',
          shops: ['Palayam Auto Spares', 'Mananchira Car Care', 'Beach Road Tyres'] },
        { name: 'Vellimadukunnu',   partner: 'Vinesh Kumar',
          shops: ['Vellimadukunnu Service Hub', 'Medical College Motors'] }
      ]
    }
  ]
});

const PRIMARY = GEOGRAPHY.districts[0];
const PRIMARY_REGION = PRIMARY.regions[0].name;

/**
 * The GST state code that must agree with `GEOGRAPHY.state`.
 *
 * ⚠️ These were `36…` — Telangana. Kerala is **32**. A GSTIN's first two digits
 * are the state, so a Kerala shop with a Telangana GSTIN is not a cosmetic slip:
 * it is the first thing anybody in the trade reads off the number, and it would
 * be spotted in a demo by exactly the audience it must not be spotted by.
 */
const GST_STATE_CODE = '32';

async function main() {
  console.log('Starting seed script...');

  // 1. Hash a standard password for all seeded accounts
  const salt = await bcrypt.genSalt(10);
  const defaultPasswordHash = await bcrypt.hash('password123', salt);

  // 2. Clear existing data to avoid duplicate conflicts
  console.log('Clearing old data...');
  await prisma.payout.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.tradeOrderItem.deleteMany({});
  await prisma.tradeOrder.deleteMany({});
  await prisma.brandDistributorMapping.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.industry.deleteMany({});

  // 3. Create Industries
  console.log('Creating industries...');
  const industries = [
    { name: 'Automobile', slug: 'automobile' },
    { name: 'Groceries', slug: 'groceries' },
    { name: 'Restaurant', slug: 'restaurant' },
    { name: 'Electronics and Home Appliances', slug: 'electronics' },
    { name: 'Textiles', slug: 'textiles' },
    { name: 'Sports', slug: 'sports' }
  ];

  const seededIndustries = [];
  for (const ind of industries) {
    const created = await prisma.industry.create({
      data: ind
    });
    seededIndustries.push(created);
  }
  
  const automobileIndustry = seededIndustries.find(i => i.slug === 'automobile');
  const groceriesIndustry = seededIndustries.find(i => i.slug === 'groceries');

  console.log(`Created ${seededIndustries.length} industries.`);

  // 4. Create Master Admin
  console.log('Creating Master Admin...');
  const master = await prisma.user.create({
    data: {
      email: 'master@roadmate.com',
      password: defaultPasswordHash,
      name: 'Narendra Kumar',
      role: 'MASTER',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India'
    }
  });

  // 5. Create State Partner
  console.log('Creating State Partner...');
  const statePartner = await prisma.user.create({
    data: {
      email: 'state@roadmate.com',
      password: defaultPasswordHash,
      name: GEOGRAPHY.statePartner,
      role: 'STATE',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      parentId: master.id,
      monthlyCost: 25000.0,
      sharePercentage: 10.0, // 10% Platform share
      bankName: 'HDFC Bank',
      accountHolder: `${GEOGRAPHY.statePartner} State Partner`,
      accountNumber: '50100223456789',
      ifscCode: 'HDFC0000001'
    }
  });

  // 6. Create Industry State Partner
  console.log('Creating Industry State Partner...');
  const indStatePartner = await prisma.user.create({
    data: {
      email: 'indstate@roadmate.com',
      password: defaultPasswordHash,
      name: GEOGRAPHY.industryStatePartner,
      role: 'IND_STATE',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      industryId: automobileIndustry.id,
      parentId: statePartner.id,
      sharePercentage: 15.0, // 15% Platform share
      bankName: 'SBI',
      accountHolder: `${GEOGRAPHY.industryStatePartner} Auto State Hub`,
      accountNumber: '10022345678',
      ifscCode: 'SBIN0001234'
    }
  });

  // 7. Create District Partner
  console.log('Creating District Partner...');
  const districtPartner = await prisma.user.create({
    data: {
      email: 'district@roadmate.com',
      password: defaultPasswordHash,
      name: PRIMARY.partner,
      role: 'DISTRICT',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      districtName: PRIMARY.name,
      industryId: automobileIndustry.id,
      parentId: indStatePartner.id,
      sharePercentage: 20.0, // 20% share
      bankName: 'ICICI Bank',
      accountHolder: `${PRIMARY.partner} District Auto`,
      accountNumber: '000701234567',
      ifscCode: 'ICIC0000007'
    }
  });

  // 8. Create Regional Partner
  console.log('Creating Regional Partner...');
  const regionalPartner = await prisma.user.create({
    data: {
      email: 'regional@roadmate.com',
      password: defaultPasswordHash,
      name: PRIMARY_REGIONAL_PARTNER,
      role: 'REGIONAL',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      districtName: PRIMARY.name,
      regionName: PRIMARY_REGION,
      industryId: automobileIndustry.id,
      parentId: districtPartner.id,
      sharePercentage: 25.0, // 25% share
      bankName: 'Axis Bank',
      accountHolder: `${PRIMARY_REGIONAL_PARTNER} ${PRIMARY_REGION} Auto`,
      accountNumber: '912010045678901',
      ifscCode: 'UTIB0000010'
    }
  });

  // 9. Create Manufacturer
  console.log('Creating Manufacturer...');
  const manufacturer = await prisma.user.create({
    data: {
      email: 'manufacturer@roadmate.com',
      password: defaultPasswordHash,
      name: 'Rajesh Sharma',
      role: 'MANUFACTURER',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      industryId: automobileIndustry.id,
      parentId: indStatePartner.id,
      businessName: 'Apex Motors Corp',
      gstNumber: `${GST_STATE_CODE}AAAAA1111A1Z1`,
      panNumber: 'AAAAA1111A',
      aadhaarNumber: '123456789012',
      bankName: 'Yes Bank',
      accountHolder: 'Apex Motors Corporate',
      accountNumber: '012345678901234',
      ifscCode: 'YESB0000001'
    }
  });

  // 10. Create Distributor
  console.log('Creating Distributor...');
  const distributor = await prisma.user.create({
    data: {
      email: 'distributor@roadmate.com',
      password: defaultPasswordHash,
      name: 'Anil Kumar',
      role: 'DISTRIBUTOR',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      districtName: PRIMARY.name,
      industryId: automobileIndustry.id,
      parentId: districtPartner.id,
      businessName: 'Deccan Auto Distributors',
      gstNumber: `${GST_STATE_CODE}BBBBB2222B2Z2`,
      panNumber: 'BBBBB2222B',
      aadhaarNumber: '987654321098',
      bankName: 'Kotak Mahindra',
      accountHolder: 'Deccan Auto Dist',
      accountNumber: '998877665544',
      ifscCode: 'KKBK0000001'
    }
  });

  // 11. Create Shop (Retail Shop Partner)
  console.log('Creating Shop...');
  const shop = await prisma.user.create({
    data: {
      email: 'shop@roadmate.com',
      password: defaultPasswordHash,
      name: 'Mohammad Ali',
      role: 'SHOP',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      districtName: PRIMARY.name,
      regionName: PRIMARY_REGION,
      industryId: automobileIndustry.id,
      parentId: regionalPartner.id,
      businessName: 'Ravipuram Auto Garage',
      gstNumber: `${GST_STATE_CODE}CCCCC3333C3Z3`,
      safetyStockBuffer: 85.0, // 85% safety stock buffer
      bankName: 'SBI',
      accountHolder: 'RoadMate Garage Retail',
      accountNumber: '334455667788',
      ifscCode: 'SBIN0000001'
    }
  });

  // 12. Create Executive (Regional Delivery / Listing Executive)
  console.log('Creating Regional Executive...');
  const executive = await prisma.user.create({
    data: {
      email: 'executive@roadmate.com',
      password: defaultPasswordHash,
      name: 'Ravi Teja',
      role: 'EXECUTIVE',
      executiveType: 'LISTING',
      isActive: true,
      approvedAt: SEED_APPROVED_AT,
      country: 'India',
      stateName: GEOGRAPHY.state,
      districtName: PRIMARY.name,
      regionName: PRIMARY_REGION,
      parentId: regionalPartner.id,
      bossId: regionalPartner.id // reports directly to the first region's partner
    }
  });

  // 13. Create Brand Distributor Mapping (Link Deccan Auto Distributors to Apex Motors Corp)
  console.log('Mapping Distributor to Manufacturer...');
  await prisma.brandDistributorMapping.create({
    data: {
      distributorId: distributor.id,
      manufacturerId: manufacturer.id,
      status: 'Active'
    }
  });

  // 14. Create Products for Manufacturer
  console.log('Creating products...');
  const products = [
    {
      name: 'Premium Alloy Wheels (Set of 4)',
      sku: 'APX-ALLOY-17',
      price: 32000.0,
      description: '17-inch premium matte black alloy wheels, high tensile strength.',
      stockLevel: 150,
      image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80',
      industryId: automobileIndustry.id,
      ownerId: manufacturer.id
    },
    {
      name: 'Synthetic Engine Oil 5W-40 (4L)',
      sku: 'APX-OIL-5W40',
      price: 2800.0,
      description: 'Fully synthetic high-performance engine oil for superior engine protection.',
      stockLevel: 800,
      image: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=400&q=80',
      industryId: automobileIndustry.id,
      ownerId: manufacturer.id
    },
    {
      name: 'Ceramic Disc Brake Pads (Front)',
      sku: 'APX-BRAKE-CER',
      price: 1850.0,
      description: 'Ultra-low dust ceramic brake pads for noiseless, heavy-duty stopping power.',
      stockLevel: 450,
      image: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=400&q=80',
      industryId: automobileIndustry.id,
      ownerId: manufacturer.id
    }
  ];

  const seededProducts = [];
  for (const prod of products) {
    const created = await prisma.product.create({
      data: prod
    });
    seededProducts.push(created);
  }

  // 15. Create Products for Distributor (purchased from Mfr and listed for Shops to purchase)
  console.log('Distributing products to Distributor stock...');
  const distProducts = [
    {
      name: 'Premium Alloy Wheels (Set of 4)',
      sku: 'APX-ALLOY-17',
      price: 36500.0, // Mark-up from distributor
      description: '17-inch premium matte black alloy wheels, high tensile strength.',
      stockLevel: 45,
      image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80',
      industryId: automobileIndustry.id,
      ownerId: distributor.id
    },
    {
      name: 'Synthetic Engine Oil 5W-40 (4L)',
      sku: 'APX-OIL-5W40',
      price: 3200.0,
      description: 'Fully synthetic high-performance engine oil for superior engine protection.',
      stockLevel: 120,
      image: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=400&q=80',
      industryId: automobileIndustry.id,
      ownerId: distributor.id
    }
  ];

  for (const prod of distProducts) {
    await prisma.product.create({
      data: prod
    });
  }

  // 16. Create B2B orders (Distributor ordering from Manufacturer)
  console.log('Creating demo orders...');
  const orderNumber = 'RM-PO-' + Math.floor(100000 + Math.random() * 900000);
  const demoOrder = await prisma.tradeOrder.create({
    data: {
      orderNumber,
      buyerId: distributor.id,
      sellerId: manufacturer.id,
      industryId: automobileIndustry.id,
      totalAmount: 106500.0,
      status: 'Approved',
      items: {
        create: [
          {
            productId: seededProducts[0].id, // Alloys
            quantity: 3,
            price: 32000.0
          },
          {
            productId: seededProducts[1].id, // Oil
            quantity: 3,
            price: 2800.0
          },
          {
            productId: seededProducts[2].id, // Brake pads
            quantity: 1,
            price: 1850.0
          }
        ]
      }
    }
  });

  // Create standard Payout Splits based on the 106,500 total.
  // 15% Platform charge split: Total commission is 15,975 INR.
  // Splits:
  // - Master gets 30% of commission = 4,792.50
  // - Regional gets 25% of commission = 3,993.75
  // - District gets 20% of commission = 3,195.00
  // - Industry State gets 15% of commission = 2,396.25
  // - State gets 10% of commission = 1,597.50
  const commPool = 106500.0 * 0.15; // 15% commission pool
  await prisma.payout.createMany({
    data: [
      { tradeOrderId: demoOrder.id, recipientId: statePartner.id, percentage: 10.0, amount: commPool * 0.10, status: 'Settled' },
      { tradeOrderId: demoOrder.id, recipientId: indStatePartner.id, percentage: 15.0, amount: commPool * 0.15, status: 'Settled' },
      { tradeOrderId: demoOrder.id, recipientId: districtPartner.id, percentage: 20.0, amount: commPool * 0.20, status: 'Settled' },
      { tradeOrderId: demoOrder.id, recipientId: regionalPartner.id, percentage: 25.0, amount: commPool * 0.25, status: 'Settled' },
      { tradeOrderId: demoOrder.id, recipientId: master.id, percentage: 30.0, amount: commPool * 0.30, status: 'Settled' }
    ]
  });

  // 17. Seed some Master/State Expenses
  console.log('Creating demo expenses...');
  await prisma.expense.create({
    data: {
      title: 'Server Hosting (AWS EC2 & RDS)',
      amount: 14500.0,
      category: 'Utility',
      notes: 'Monthly hosting charges for PostgreSQL cluster and API service.',
      userId: master.id
    }
  });

  await prisma.expense.create({
    data: {
      title: `${PRIMARY.name} Hub Marketing Brochures`,
      amount: 4800.0,
      category: 'Marketing',
      notes: `Printed 500 brochures for ${GEOGRAPHY.state} district onboarding drives.`,
      userId: statePartner.id
    }
  });

  // 18. Seed every remaining region, across **both** districts, for a populated demo.
  // Each region gets a regional partner, 2-3 shops, two delivery partners, and
  // some delivered orders so the District "Revenue Summary" drill-downs show real data.
  console.log('Seeding extra regions, shops, riders and shop orders...');

  // ⚠️ **Two districts, not one** (2026-08-11). Kochi's district partner is
  // created above as `districtPartner`; every district after the first needs its
  // own, or its regions hang off a partner in the wrong district and are
  // invisible to the approval and revenue queries, which match `districtName`
  // exactly.
  //
  // The second district also exists to prove something the demo could not show
  // before: serviceability is a per-shop radius, not a national switch. Kochi and
  // Kozhikode are 180 km apart, so a customer in one finds only that one's shops.
  const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '');
  // A Kerala plate is four groups — KL-07-AB-1234. Five reads as invented.
  const LETTERS = ['AB', 'CD', 'EF', 'GH', 'JK'];

  const districtPartners = new Map([[PRIMARY.name, districtPartner]]);

  for (const district of GEOGRAPHY.districts.slice(1)) {
    const created = await prisma.user.create({
      data: {
        email: `district.${slug(district.name)}@roadmate.com`,
        password: defaultPasswordHash,
        name: district.partner,
        role: 'DISTRICT',
        isActive: true,
        approvedAt: SEED_APPROVED_AT,
        country: 'India',
        stateName: GEOGRAPHY.state,
        districtName: district.name,
        industryId: automobileIndustry.id,
        parentId: indStatePartner.id,
        sharePercentage: 20.0,
        bankName: 'Federal Bank',
        accountHolder: `${district.partner} District Auto`,
        accountNumber: `1470100${String(district.name.length).padStart(6, '0')}`,
        ifscCode: 'FDRL0001470'
      }
    });
    districtPartners.set(district.name, created);
  }

  // Every region of every district, minus the one the original regional partner
  // above already covers.
  const regionPlan = GEOGRAPHY.districts.flatMap((district) =>
    district.regions
      .filter((region) => !(district.name === PRIMARY.name && region.name === PRIMARY_REGION))
      .map((region, index) => ({
        region: region.name,
        partner: region.partner,
        shopNames: region.shops,
        district: district.name,
        plate: district.plate,
        // 2 or 3 shops, alternating, so the revenue drill-down is not a flat line.
        shops: region.shops.length
      }))
  );

  let orderSeq = 1;

  // Date helpers so seeded orders span periods (This Month / This Year / All Time),
  // robust to whatever month the seed is run in.
  const seedNow = new Date();
  const thisMonth = (day = 5) => new Date(seedNow.getFullYear(), seedNow.getMonth(), Math.min(day, seedNow.getDate()));
  const earlierThisYear = (i) => {
    // A month strictly before the current month, within the current calendar year.
    if (seedNow.getMonth() === 0) return new Date(seedNow.getFullYear(), 0, 3); // Jan: only "this year" option
    return new Date(seedNow.getFullYear(), i % seedNow.getMonth(), 12);
  };
  const lastYear = (month = 3) => new Date(seedNow.getFullYear() - 1, month, 12);

  // Helper: create a delivered shop order so region revenue is non-zero.
  // `createdAt` lets us spread revenue across time so the period filter is meaningful.
  const createShopOrder = async (shopUser, amount, createdAt = new Date()) => {
    const order = await prisma.tradeOrder.create({
      data: {
        orderNumber: `RM-SO-${Date.now()}-${orderSeq++}`,
        buyerId: shopUser.id,
        sellerId: distributor.id,
        industryId: automobileIndustry.id,
        totalAmount: amount,
        status: 'Delivered',
        createdAt,
        items: {
          create: [{ productId: seededProducts[1].id, quantity: Math.ceil(amount / 3200), price: 3200.0 }]
        }
      }
    });
    const commPool = amount * 0.15;
    await prisma.payout.createMany({
      data: [
        { tradeOrderId: order.id, recipientId: districtPartner.id, percentage: 20.0, amount: commPool * 0.20, status: 'Settled' },
        { tradeOrderId: order.id, recipientId: master.id,          percentage: 30.0, amount: commPool * 0.30, status: 'Settled' }
      ]
    });
  };

  for (const plan of regionPlan) {
    const rslug = slug(plan.region);
    const regPartner = await prisma.user.create({
      data: {
        email: `regional.${rslug}@roadmate.com`,
        password: defaultPasswordHash,
        name: plan.partner,
        role: 'REGIONAL',
        isActive: true,
        approvedAt: SEED_APPROVED_AT,
        country: 'India',
        stateName: GEOGRAPHY.state,
        districtName: plan.district,
        regionName: plan.region,
        industryId: automobileIndustry.id,
        parentId: districtPartners.get(plan.district).id,
        sharePercentage: 25.0
      }
    });

    for (let s = 1; s <= plan.shops; s++) {
      const shopUser = await prisma.user.create({
        data: {
          email: `shop.${rslug}${s}@roadmate.com`,
          password: defaultPasswordHash,
          name: plan.shopNames[s - 1],
          role: 'SHOP',
          isActive: true,
          approvedAt: SEED_APPROVED_AT,
          country: 'India',
          stateName: GEOGRAPHY.state,
          districtName: plan.district,
          regionName: plan.region,
          industryId: automobileIndustry.id,
          parentId: regPartner.id,
          businessName: plan.shopNames[s - 1],
          monthlyCost: 5000.0
        }
      });
      // Delivered orders spread across periods so the time filter is demonstrable:
      //  - one this month, one earlier this year, and (sometimes) one last year.
      await createShopOrder(shopUser, 18000 + ((s * 7) % 5) * 6400, thisMonth(3 + s));         // This Month
      await createShopOrder(shopUser, 22000 + (s % 3) * 4800,       earlierThisYear(s + 1));   // earlier This Year
      if (s % 2 === 0) await createShopOrder(shopUser, 24000 + (s % 3) * 4800, lastYear(2 + (s % 6))); // Last year
    }

    // Two delivery partners (riders) per region.
    for (let r = 1; r <= 2; r++) {
      await prisma.user.create({
        data: {
          email: `rider.${rslug}${r}@roadmate.com`,
          password: defaultPasswordHash,
          name: nextRiderName(),
          role: 'EXECUTIVE',
          executiveType: 'DELIVERY',
          isActive: true,
          approvedAt: SEED_APPROVED_AT,
          country: 'India',
          stateName: GEOGRAPHY.state,
          districtName: plan.district,
          regionName: plan.region,
          parentId: regPartner.id,
          bossId: regPartner.id,
          phone: `9${(800000000 + orderSeq * 137 + r).toString().slice(0, 9)}`,
          vehicleType: r % 2 === 0 ? 'Mini Truck' : 'Bike',
          vehicleNumber: `${plan.plate}${LETTERS[r % LETTERS.length]}${(1000 + orderSeq * 7 + r).toString().slice(-4)}`
        }
      });
    }
  }

  // Delivery partners directly under the first district's first regional partner.
  const namedRiders = [
    { name: 'Basheer Koya',   vehicleType: 'Bike',       vehicleNumber: `${PRIMARY.plate}BC4521`, phone: '9876500011' },
    { name: 'Prajeesh Nair',  vehicleType: 'Mini Truck', vehicleNumber: `${PRIMARY.plate}CD7834`, phone: '9876500022' },
    { name: 'Sooraj Menon',   vehicleType: 'Bike',       vehicleNumber: `${PRIMARY.plate}DE1290`, phone: '9876500033' }
  ];
  for (const rider of namedRiders) {
    await prisma.user.create({
      data: {
        email: `${rider.name.toLowerCase().replace(/[^a-z]+/g, '.')}@roadmate.com`,
        password: defaultPasswordHash,
        name: rider.name,
        role: 'EXECUTIVE',
        executiveType: 'DELIVERY',
        isActive: true,
        approvedAt: SEED_APPROVED_AT,
        country: 'India',
        stateName: GEOGRAPHY.state,
        districtName: PRIMARY.name,
        regionName: PRIMARY_REGION,
        parentId: regionalPartner.id,
        bossId: regionalPartner.id,
        phone: rider.phone,
        vehicleType: rider.vehicleType,
        vehicleNumber: rider.vehicleNumber
      }
    });
  }

  // Give the first district's original shop delivered orders across periods too.
  await createShopOrder(shop, 21500, thisMonth(8));        // This Month
  await createShopOrder(shop, 16800, earlierThisYear(2));  // earlier This Year
  await createShopOrder(shop, 19400, lastYear(7));         // Last year

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
