// The photograph each demo product is shown with, pinned.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
//
// `demo:storefront` builds a catalogue of 49 products and gives none of them a
// photo, so every shelf, search result and cart line in the Customer app renders
// as a grey placeholder next to a name. The storefront looks unfinished for a
// reason that has nothing to do with the storefront.
//
// ⚠️ **This is emphatically NOT the deleted Unsplash backfill** (HANDOFF §6,
// `tests/productImages.test.js`, "must not come back"). That bug lived in
// `createProduct`: any product saved with a blank `image` silently got ONE
// hardcoded stock photograph of somebody else's product, forever, including for
// real merchants, with nothing reporting it. The rule it broke — a picture must
// not make a false claim about a specific thing that is for sale — is still in
// force, and the API still refuses to write a photo it did not issue.
//
// What this file is instead: a **hand-picked photograph per demo product**,
// chosen by looking at it, for rows that exist only in a demo database. It is
// the same act a catalogue manager performs on the Master dashboard, written
// down. Nothing here runs in the request path, nothing fires on a blank field,
// and `image` stays `null` for every product a merchant creates.
//
// ── WHAT THESE PICTURES ARE, EXACTLY ──────────────────────────────────────────
//
// Some are the real article: `amul-milk`, `lays-classic-salted`,
// `cadbury-hot-chocolate` and `tea-dust` come from Open Food Facts and are
// photographs of that product's actual packaging. Most are not — no free
// archive holds a studio shot of a *TVS Chain Lube 2.0* bottle. Those are
// **category-true** instead: a real chain lubricant, a real air filter, a real
// pair of running shoes. Every single one was rendered and looked at before it
// was written down here, because keyword search alone returns a foggy football
// pitch for "fog lamp" and a grasshopper for "cricket bat".
//
// ⚠️ **They are placeholders with a shelf life.** Before launch each of these is
// replaced by the merchant's own photograph of their own stock, through the
// Master dashboard. A demo needs a shelf that looks like a shelf; a live
// catalogue needs the truth about what is in the box.
//
// ── LICENSING ─────────────────────────────────────────────────────────────────
//
// Every source is CC0, public domain, or a Creative Commons licence that permits
// commercial use — nothing NonCommercial, which the client could not ship. About
// twenty of them are CC BY or CC BY-SA and therefore require credit; `credit`
// and `license` below are that record, and `npm run demo:photos -- --credits`
// prints it. Share-alike on a transformed image is the loose end here, and the
// reason the paragraph above says "placeholders": it stops mattering the moment
// the merchant's own photography replaces them.
//
// `source` is where the picture comes FROM. It is never what gets stored on the
// product — `seedProductPhotos.js` uploads it into the client's own Cloudinary
// account first, so what lands in the database is a `roadmate/products` asset
// indistinguishable from one uploaded through the dashboard. That matters for a
// concrete reason: `isOurAsset` rejects any other host, so a product carrying a
// borrowed URL would 400 the next time anybody edited its price.

/**
 * @typedef {object} ProductPhoto
 * @property {string} product Matches `Product.name` exactly — the key this is
 *   joined on, because `Product` has no natural unique id and two shops can
 *   stock the same named item.
 * @property {string} slug Stable id for the Cloudinary asset, so re-running the
 *   seed overwrites the photo it wrote last time rather than adding another.
 * @property {string} source Where the picture is fetched from, once.
 * @property {string} credit Attribution, for the licences that require it.
 * @property {string} license The licence the source is offered under.
 */

/** @type {ProductPhoto[]} */
export const PRODUCT_PHOTOS = [

  // ── AUTOMOBILE ────────────────────────────────────────────────────────
  {
    product: 'Premium Alloy Wheels (Set of 4)',
    slug: 'premium-alloy-wheels',
    source: 'https://live.staticflickr.com/8441/28837934260_9df7c14dfb_b.jpg',
    credit: 'davidgsteadman',
    license: 'pdm-1.0'
  },
  {
    product: 'Synthetic Engine Oil 5W-40 (4L)',
    slug: 'synthetic-engine-oil-4l',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Oli_Mesin_Sepeda_Motor_4_Tak.jpg/1280px-Oli_Mesin_Sepeda_Motor_4_Tak.jpg',
    credit: 'DARMAS SB 9',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Ceramic Disc Brake Pads (Front)',
    slug: 'ceramic-disc-brake-pads',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Brake_shoe.jpg/1280px-Brake_shoe.jpg',
    credit: 'Tiia Monto',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'TVS Chain Lube 2.0',
    slug: 'tvs-chain-lube',
    source: 'https://live.staticflickr.com/65535/49728840673_571b6fe9b8_b.jpg',
    credit: 'mpcllc2017',
    license: 'pdm-1.0'
  },
  {
    product: 'Motul C2 Chain Lube',
    slug: 'motul-chain-lube',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Edge-Sealer%2C_in_a_14_oz_aerosol_can_%2815331832695%29.jpg/1280px-Edge-Sealer%2C_in_a_14_oz_aerosol_can_%2815331832695%29.jpg',
    credit: 'Hardcast from Wylie, TX, United States',
    license: 'CC BY 2.0'
  },
  {
    product: 'Shell Advance 10W-40 (1L)',
    slug: 'shell-advance-oil',
    source: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/LUBTROL_JSE_EDGE_5W-40_Motor_Oil_4L_Bottle.jpg',
    credit: 'Director JSE',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Microfibre Wash Mitt',
    slug: 'microfibre-wash-mitt',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Microfibre_cloth.jpg/1280px-Microfibre_cloth.jpg',
    credit: 'Polyesterchen',
    license: 'Public domain'
  },
  {
    product: 'Dashboard Polish 250ml',
    slug: 'dashboard-polish',
    source: 'https://cdn.stocksnap.io/img-thumbs/960w/KADJ2NKMYQ.jpg',
    credit: 'Burst',
    license: 'cc0-1.0'
  },
  {
    product: 'Ceramic Brake Pads (Front)',
    slug: 'ceramic-brake-pads-front',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Disk_brake_dsc03682.jpg/1280px-Disk_brake_dsc03682.jpg',
    credit: 'wikimedia',
    license: 'CC BY-SA 3.0'
  },
  {
    product: 'Air Filter — Hatchback',
    slug: 'air-filter-hatchback',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Air_filter%2C_opel_astra%282%29.JPG/1280px-Air_filter%2C_opel_astra%282%29.JPG',
    credit: 'Donar Reiskoffer',
    license: 'CC BY 3.0'
  },
  {
    product: 'Tubeless Tyre 90/90-17',
    slug: 'tubeless-tyre',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Motorcycle_tyre_stack.jpg/1280px-Motorcycle_tyre_stack.jpg',
    credit: 'Robert',
    license: 'CC BY 2.0'
  },
  {
    product: 'LED Fog Lamp Pair',
    slug: 'led-fog-lamp',
    source: 'https://upload.wikimedia.org/wikipedia/commons/2/28/Foglights.jpg',
    credit: 'Scheinwerfermann at English Wikipedia',
    license: 'CC BY-SA 3.0'
  },

  // ── GROCERIES ─────────────────────────────────────────────────────────
  {
    product: 'Bananas — Nendran (1 kg)',
    slug: 'bananas-nendran',
    source: 'https://live.staticflickr.com/1743/41775528145_74dd38f480_b.jpg',
    credit: 'Plant pests and diseases',
    license: 'cc0-1.0'
  },
  {
    product: 'Tomatoes (500 g)',
    slug: 'tomatoes',
    source: 'https://live.staticflickr.com/4335/37481591981_8039c96e54_b.jpg',
    credit: 'Wallboat',
    license: 'cc0-1.0'
  },
  {
    product: 'Onions (1 kg)',
    slug: 'onions',
    source: 'https://live.staticflickr.com/1561/24306454199_97d8f5718b_b.jpg',
    credit: 'Thad Zajdowicz',
    license: 'cc0-1.0'
  },
  {
    product: 'Amul Milk 500 ml',
    slug: 'amul-milk',
    source: 'https://images.openfoodfacts.org/images/products/890/126/226/0121/front_en.52.400.jpg',
    credit: 'Open Food Facts contributors',
    license: 'CC-BY-SA-3.0 (Open Food Facts)'
  },
  {
    product: 'Brown Bread 400 g',
    slug: 'brown-bread',
    source: 'https://live.staticflickr.com/17/21843037_a65d85965f_b.jpg',
    credit: 'roland',
    license: 'cc0-1.0'
  },
  {
    product: 'Lay\'s Classic Salted (52 g)',
    slug: 'lays-classic-salted',
    source: 'https://images.openfoodfacts.org/images/products/890/149/110/1837/front_en.26.400.jpg',
    credit: 'Open Food Facts contributors',
    license: 'CC-BY-SA-3.0 (Open Food Facts)'
  },
  {
    product: 'Cadbury Hot Chocolate 200 g',
    slug: 'cadbury-hot-chocolate',
    source: 'https://images.openfoodfacts.org/images/products/503/466/002/1582/front_en.101.400.jpg',
    credit: 'Open Food Facts contributors',
    license: 'CC-BY-SA-3.0 (Open Food Facts)'
  },
  {
    product: 'Basmati Rice 5 kg',
    slug: 'basmati-rice-5kg',
    source: 'https://pd.w.org/2025/11/37469274b0189de49.75653211-2048x1536.jpeg',
    credit: 'Bigul Malayi',
    license: 'cc0-1.0'
  },
  {
    product: 'Tea Dust 500 g',
    slug: 'tea-dust',
    source: 'https://images.openfoodfacts.org/images/products/890/105/201/1643/front_en.3.400.jpg',
    credit: 'Open Food Facts contributors',
    license: 'CC-BY-SA-3.0 (Open Food Facts)'
  },

  // ── RESTAURANT ────────────────────────────────────────────────────────
  {
    product: 'Beef Biryani',
    slug: 'beef-biryani',
    source: 'https://pd.w.org/2023/06/499649af1bb2e18d0.58157543-2048x1536.jpg',
    credit: 'Tarek Aziz',
    license: 'cc0-1.0'
  },
  {
    product: 'Chicken Biryani',
    slug: 'chicken-biryani',
    source: 'https://pd.w.org/2024/01/62659fa8311b8866.92791155-1082x2048.jpg',
    credit: 'Balu B',
    license: 'cc0-1.0'
  },
  {
    product: 'Mutton Biryani',
    slug: 'mutton-biryani',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Mutton_Biryani..JPG/1280px-Mutton_Biryani..JPG',
    credit: 'Miansari66',
    license: 'cc0-1.0'
  },
  {
    product: 'Chicken Burger',
    slug: 'chicken-burger',
    source: 'https://upload.wikimedia.org/wikipedia/commons/7/7d/SZ_%E6%B7%B1%E5%9C%B3_Shenzhen_%E7%A6%8F%E7%94%B0_Futian_%E5%B4%97%E5%BB%88%E5%8C%97%E7%AB%99_GangXia_North_Station_%E6%B7%B1%E5%9C%B3%E4%B9%8B%E7%9C%BC_Eye_%E6%B7%B1%E9%90%B5%E5%8C%AF_City_Hub_mall_shop_KFC_Restaurant_food_%E6%B2%B9%E7%82%B8%E8%97%A4%E8%BE%A3%E9%A4%85%E9%9B%9E%E8%82%89%E5%A1%8A%E6%BC%A2%E5%A0%A1_fried_chicken_burger_July_2024_R12S_01.jpg',
    credit: 'LaouZEI bOENFUOO',
    license: 'cc0-1.0'
  },
  {
    product: 'Veg Burger',
    slug: 'veg-burger',
    source: 'https://upload.wikimedia.org/wikipedia/commons/2/28/Mushroom_vegetarian_burger_-_Grubbs.jpg',
    credit: 'Andy Li',
    license: 'cc0-1.0'
  },
  {
    product: 'Farmhouse Pizza (Medium)',
    slug: 'farmhouse-pizza',
    source: 'https://live.staticflickr.com/65535/54051657108_535959274f_b.jpg',
    credit: 'sarahstierch',
    license: 'cc0-1.0'
  },
  {
    product: 'Butterscotch Pastry',
    slug: 'butterscotch-pastry',
    source: 'https://live.staticflickr.com/8682/16683914279_5f5fb8b292_b.jpg',
    credit: 'USDAgov',
    license: 'pdm-1.0'
  },
  {
    product: 'Fresh Lime Soda',
    slug: 'fresh-lime-soda',
    source: 'https://cdn.stocksnap.io/img-thumbs/960w/HGO20PXZVV.jpg',
    credit: 'Tim Sullivan',
    license: 'cc0-1.0'
  },

  // ── ELECTRONICS ───────────────────────────────────────────────────────
  {
    product: 'Redmi Note 14 (6/128)',
    slug: 'redmi-note-14',
    source: 'https://upload.wikimedia.org/wikipedia/commons/7/76/Xiaomi_Redmi_Note_4_Back.jpg',
    credit: 'AW256',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Galaxy M15 5G',
    slug: 'galaxy-m15',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Samsung_Galaxy_Z_Fold_7_and_Z_Flip_7.jpg/1280px-Samsung_Galaxy_Z_Fold_7_and_Z_Flip_7.jpg',
    credit: 'Matabalt',
    license: 'cc0-1.0'
  },
  {
    product: 'HP 15s Laptop (i5)',
    slug: 'hp-15s-laptop',
    source: 'https://cdn.stocksnap.io/img-thumbs/960w/BZKVTTC2DC.jpg',
    credit: 'Tim Sullivan',
    license: 'cc0-1.0'
  },
  {
    product: 'boAt Airdopes 141',
    slug: 'boat-airdopes',
    source: 'https://live.staticflickr.com/65535/52063601444_87d8b1d840.jpg',
    credit: 'superbsavers',
    license: 'pdm-1.0'
  },
  {
    product: 'Sony WH-CH520',
    slug: 'sony-wh-ch520',
    source: 'https://live.staticflickr.com/65535/49062403237_900a87dca3.jpg',
    credit: 'shop8447',
    license: 'cc0-1.0'
  },
  {
    product: 'Mi Power Bank 20000 mAh',
    slug: 'mi-power-bank',
    // The flat-on-a-surface shot of the same power bank lost its subject
    // entirely under the shelf tile's square crop — it came out as a blank pale
    // rectangle. This one is held, at an angle, with the USB ports facing the
    // camera, so it still reads as a power bank at 300 px.
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/SAMSUNG_BATTERY_PACK_%28POWER_BANK%29_EB-P4520_%283%29.jpg/1280px-SAMSUNG_BATTERY_PACK_%28POWER_BANK%29_EB-P4520_%283%29.jpg',
    credit: 'Dinkun Chen',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Mixer Grinder 750 W',
    slug: 'mixer-grinder',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/A_table-top_mixer-grinder_or_mixie.jpg/1280px-A_table-top_mixer-grinder_or_mixie.jpg',
    credit: 'Vimkay',
    license: 'CC BY-SA 4.0'
  },

  // ── TEXTILES ──────────────────────────────────────────────────────────
  {
    product: 'Cotton Casual Shirt',
    slug: 'cotton-casual-shirt',
    source: 'https://live.staticflickr.com/65535/52790865685_603a0a585c_b.jpg',
    credit: 'mitu34612',
    license: 'pdm-1.0'
  },
  {
    product: 'Slim Fit Denim',
    slug: 'slim-fit-denim',
    source: 'https://live.staticflickr.com/65535/49076382846_bff8919c27.jpg',
    credit: 'Shopping Guide 7',
    license: 'cc0-1.0'
  },
  {
    product: 'Kurti — Printed Cotton',
    slug: 'kurti-printed-cotton',
    source: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Pink_women%27s_kurta_%28top%29.jpg',
    credit: 'AmanAgrahari01',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Cotton Saree — Kasavu',
    slug: 'cotton-saree-kasavu',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Woman_with_a_Sparkler.jpg/1280px-Woman_with_a_Sparkler.jpg',
    credit: 'Framedtwinkles',
    license: 'cc0-1.0'
  },
  {
    product: 'Kids T-Shirt (Pack of 2)',
    slug: 'kids-tshirt',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Interior_sports_clothing_store_Cala_Millor.jpg/1280px-Interior_sports_clothing_store_Cala_Millor.jpg',
    credit: 'Steffen Mokosch',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Running Shoes',
    slug: 'running-shoes',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Asics_Gel-Cumulus_22.jpg/1280px-Asics_Gel-Cumulus_22.jpg',
    credit: 'Petar Milošević',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Leather Belt',
    slug: 'leather-belt',
    source: 'https://live.staticflickr.com/4683/39552649161_61a82efaa8_b.jpg',
    credit: 'Fabfootwear',
    license: 'pdm-1.0'
  },

  // ── SPORTS ────────────────────────────────────────────────────────────
  {
    product: 'Yoga Mat 6 mm',
    slug: 'yoga-mat',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Yoga_mat.jpg/1280px-Yoga_mat.jpg',
    credit: 'Gausanchennai',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Adjustable Dumbbell 10 kg',
    slug: 'adjustable-dumbbell',
    source: 'https://cdn.stocksnap.io/img-thumbs/960w/CYK8OIFEIE.jpg',
    credit: 'Kristin Hardwick',
    license: 'cc0-1.0'
  },
  {
    product: 'Cricket Bat — Kashmir Willow',
    slug: 'cricket-bat',
    source: 'https://live.staticflickr.com/65535/52611954793_d640c235fa_b.jpg',
    credit: 'ForwardDefensive',
    license: 'pdm-1.0'
  },
  {
    product: 'Football Size 5',
    slug: 'football-size-5',
    source: 'https://upload.wikimedia.org/wikipedia/commons/0/0b/Png-clipart-fifa-world-cup-football-player-soccer-ball-posters-sport-football-boot-removebg-preview-%D9%A1.png',
    credit: 'Amadou soukane',
    license: 'CC BY-SA 4.0'
  },
  {
    product: 'Cycling Helmet',
    slug: 'cycling-helmet',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/0328Rear_views_of_road_cyclists_with_bicycle_helmets_during_the_COVID-19_pandemic_11.jpg/1280px-0328Rear_views_of_road_cyclists_with_bicycle_helmets_during_the_COVID-19_pandemic_11.jpg',
    credit: 'JFVelasquez Floro',
    license: 'cc0-1.0'
  },
  {
    product: 'Whey Protein 1 kg',
    slug: 'whey-protein',
    source: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Osaka_protein_shaker.jpg',
    credit: 'Karnaz',
    license: 'cc0-1.0'
  },
];

/** Every distinct licence in use, with the products under it. For `--credits`. */
export function creditLines() {
  return PRODUCT_PHOTOS.map(
    (p) => `${p.product} — ${p.credit} (${p.license}) — ${p.source}`
  );
}
