import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed script...');

  // 1. Hash a standard password for all seeded accounts
  const salt = await bcrypt.genSalt(10);
  const defaultPasswordHash = await bcrypt.hash('password123', salt);

  // 2. Clear existing data to avoid duplicate conflicts
  console.log('Clearing old data...');
  await prisma.payout.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
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
      country: 'India'
    }
  });

  // 5. Create State Partner
  console.log('Creating State Partner...');
  const statePartner = await prisma.user.create({
    data: {
      email: 'state@roadmate.com',
      password: defaultPasswordHash,
      name: 'K. Chandrashekar',
      role: 'STATE',
      isActive: true,
      country: 'India',
      stateName: 'Telangana',
      parentId: master.id,
      monthlyCost: 25000.0,
      sharePercentage: 10.0, // 10% Platform share
      bankName: 'HDFC Bank',
      accountHolder: 'K. Chandrashekar State Partner',
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
      name: 'Suresh Gowd',
      role: 'IND_STATE',
      isActive: true,
      country: 'India',
      stateName: 'Telangana',
      industryId: automobileIndustry.id,
      parentId: statePartner.id,
      sharePercentage: 15.0, // 15% Platform share
      bankName: 'SBI',
      accountHolder: 'Suresh Gowd Auto State Hub',
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
      name: 'Venkata Rao',
      role: 'DISTRICT',
      isActive: true,
      country: 'India',
      stateName: 'Telangana',
      districtName: 'Hyderabad District',
      industryId: automobileIndustry.id,
      parentId: indStatePartner.id,
      sharePercentage: 20.0, // 20% share
      bankName: 'ICICI Bank',
      accountHolder: 'Venkata Rao District Auto',
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
      name: 'Naresh Reddy',
      role: 'REGIONAL',
      isActive: true,
      country: 'India',
      stateName: 'Telangana',
      districtName: 'Hyderabad District',
      regionName: 'Banjara Hills',
      industryId: automobileIndustry.id,
      parentId: districtPartner.id,
      sharePercentage: 25.0, // 25% share
      bankName: 'Axis Bank',
      accountHolder: 'Naresh Reddy Banjara Auto',
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
      country: 'India',
      stateName: 'Telangana',
      industryId: automobileIndustry.id,
      parentId: indStatePartner.id,
      businessName: 'Apex Motors Corp',
      gstNumber: '36AAAAA1111A1Z1',
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
      country: 'India',
      stateName: 'Telangana',
      districtName: 'Hyderabad District',
      industryId: automobileIndustry.id,
      parentId: districtPartner.id,
      businessName: 'Deccan Auto Distributors',
      gstNumber: '36BBBBB2222B2Z2',
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
      country: 'India',
      stateName: 'Telangana',
      districtName: 'Hyderabad District',
      regionName: 'Banjara Hills',
      industryId: automobileIndustry.id,
      parentId: regionalPartner.id,
      businessName: 'RoadMate Garage Outlet',
      gstNumber: '36CCCCC3333C3Z3',
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
      country: 'India',
      stateName: 'Telangana',
      districtName: 'Hyderabad District',
      regionName: 'Banjara Hills',
      parentId: regionalPartner.id,
      bossId: regionalPartner.id // Ravi reports directly to Naresh Reddy
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
  const demoOrder = await prisma.order.create({
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
      { orderId: demoOrder.id, recipientId: statePartner.id, percentage: 10.0, amount: commPool * 0.10, status: 'Settled' },
      { orderId: demoOrder.id, recipientId: indStatePartner.id, percentage: 15.0, amount: commPool * 0.15, status: 'Settled' },
      { orderId: demoOrder.id, recipientId: districtPartner.id, percentage: 20.0, amount: commPool * 0.20, status: 'Settled' },
      { orderId: demoOrder.id, recipientId: regionalPartner.id, percentage: 25.0, amount: commPool * 0.25, status: 'Settled' },
      { orderId: demoOrder.id, recipientId: master.id, percentage: 30.0, amount: commPool * 0.30, status: 'Settled' }
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
      title: 'Hyderabad Hub Marketing Brochures',
      amount: 4800.0,
      category: 'Marketing',
      notes: 'Printed 500 brochures for Telangana district onboarding drives.',
      userId: statePartner.id
    }
  });

  // 18. Seed additional regions under the district for a populated demo.
  // Each region gets a regional partner, 2-3 shops, a delivery executive, and
  // some delivered orders so the District "Revenue Summary" drill-downs show real data.
  console.log('Seeding extra regions, shops, riders and shop orders...');

  const regionPlan = [
    { region: 'Jubilee Hills',  shops: 3 },
    { region: 'Kukatpally',     shops: 2 },
    { region: 'Secunderabad',   shops: 3 },
    { region: 'Ameerpet',       shops: 2 }
  ];

  const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '');
  let orderSeq = 1;

  // Helper: create a delivered shop order so region revenue is non-zero.
  const createShopOrder = async (shopUser, amount) => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `RM-SO-${Date.now()}-${orderSeq++}`,
        buyerId: shopUser.id,
        sellerId: distributor.id,
        industryId: automobileIndustry.id,
        totalAmount: amount,
        status: 'Delivered',
        items: {
          create: [{ productId: seededProducts[1].id, quantity: Math.ceil(amount / 3200), price: 3200.0 }]
        }
      }
    });
    const commPool = amount * 0.15;
    await prisma.payout.createMany({
      data: [
        { orderId: order.id, recipientId: districtPartner.id, percentage: 20.0, amount: commPool * 0.20, status: 'Settled' },
        { orderId: order.id, recipientId: master.id,          percentage: 30.0, amount: commPool * 0.30, status: 'Settled' }
      ]
    });
  };

  for (const plan of regionPlan) {
    const rslug = slug(plan.region);
    const regPartner = await prisma.user.create({
      data: {
        email: `regional.${rslug}@roadmate.com`,
        password: defaultPasswordHash,
        name: `${plan.region} Regional Partner`,
        role: 'REGIONAL',
        isActive: true,
        country: 'India',
        stateName: 'Telangana',
        districtName: 'Hyderabad District',
        regionName: plan.region,
        industryId: automobileIndustry.id,
        parentId: districtPartner.id,
        sharePercentage: 25.0
      }
    });

    for (let s = 1; s <= plan.shops; s++) {
      const shopUser = await prisma.user.create({
        data: {
          email: `shop.${rslug}${s}@roadmate.com`,
          password: defaultPasswordHash,
          name: `${plan.region} Auto Shop ${s}`,
          role: 'SHOP',
          isActive: true,
          country: 'India',
          stateName: 'Telangana',
          districtName: 'Hyderabad District',
          regionName: plan.region,
          industryId: automobileIndustry.id,
          parentId: regPartner.id,
          businessName: `${plan.region} Garage ${s}`,
          monthlyCost: 5000.0
        }
      });
      // 1-2 delivered orders per shop with varied amounts.
      await createShopOrder(shopUser, 18000 + ((s * 7) % 5) * 6400);
      if (s % 2 === 0) await createShopOrder(shopUser, 24000 + (s % 3) * 4800);
    }

    // Two delivery partners (riders) per region.
    for (let r = 1; r <= 2; r++) {
      await prisma.user.create({
        data: {
          email: `rider.${rslug}${r}@roadmate.com`,
          password: defaultPasswordHash,
          name: `${plan.region} Rider ${r}`,
          role: 'EXECUTIVE',
          executiveType: 'DELIVERY',
          isActive: true,
          country: 'India',
          stateName: 'Telangana',
          districtName: 'Hyderabad District',
          regionName: plan.region,
          parentId: regPartner.id,
          bossId: regPartner.id,
          phone: `9${(800000000 + orderSeq * 137 + r).toString().slice(0, 9)}`,
          vehicleType: r % 2 === 0 ? 'Mini Truck' : 'Bike',
          vehicleNumber: `TS${(10 + r)}AB${(1000 + orderSeq * 7 + r).toString().slice(-4)}`
        }
      });
    }
  }

  // Delivery partners directly under the original Banjara Hills regional partner.
  const banjaraRiders = [
    { name: 'Imran Khan',   vehicleType: 'Bike',       vehicleNumber: 'TS09BC4521', phone: '9876500011' },
    { name: 'Suresh Yadav', vehicleType: 'Mini Truck', vehicleNumber: 'TS09CD7834', phone: '9876500022' },
    { name: 'Praveen Goud', vehicleType: 'Bike',       vehicleNumber: 'TS09DE1290', phone: '9876500033' }
  ];
  for (const rider of banjaraRiders) {
    await prisma.user.create({
      data: {
        email: `${rider.name.toLowerCase().replace(/[^a-z]+/g, '.')}@roadmate.com`,
        password: defaultPasswordHash,
        name: rider.name,
        role: 'EXECUTIVE',
        executiveType: 'DELIVERY',
        isActive: true,
        country: 'India',
        stateName: 'Telangana',
        districtName: 'Hyderabad District',
        regionName: 'Banjara Hills',
        parentId: regionalPartner.id,
        bossId: regionalPartner.id,
        phone: rider.phone,
        vehicleType: rider.vehicleType,
        vehicleNumber: rider.vehicleNumber
      }
    });
  }

  // Give the original Banjara Hills shop a couple of delivered orders too.
  await createShopOrder(shop, 21500);
  await createShopOrder(shop, 16800);

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
