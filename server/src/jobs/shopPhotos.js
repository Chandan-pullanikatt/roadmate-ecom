// The photograph each demo shop is shown with, pinned.
//
// The sibling of `productPhotos.js`, and it exists for the same reason: the
// storefront card in the Customer app has rendered `coverImageUrl || logoUrl`
// since the 2026-08-10 pass, both columns have been on `User` since Phase 0, and
// **nothing had ever written to either**. So every shop on the Popular Shops row
// fell back to its industry glyph, and 54 shops shared six pictures between them.
//
// ── COVER ONLY, NEVER A LOGO ──────────────────────────────────────────────────
//
// `seedDemoPhotos.js` writes `coverImageUrl` and deliberately leaves `logoUrl`
// null. A cover is a photograph *of premises* — a workshop with its shutter up, a
// supermarket aisle, a rail of clothes — and a stand-in for one is a picture of a
// shop that looks like this shop. A logo is a **business's identity**: inventing
// one attributes a brand mark to a named business that does not use it, which is
// a different and much worse kind of wrong than a generic photo of a garage. The
// card already prefers the cover, so nothing is lost by leaving the other empty.
//
// ── WHAT THESE PICTURES ARE ───────────────────────────────────────────────────
//
// Category-true premises, not these businesses. There is no free photograph of
// *Paragon Restaurant* in Kozhikode, and there was never going to be. Each is a
// real photograph of a real shop of that kind, picked so no two of the 36 share
// one — a row where every card carries the same stock garage is worse than the
// glyph it replaced, because it reads as six branches of one chain.
//
// ⚠️ These are placeholders, with the same shelf life as the product ones: a real
// shop photographs its own front. That also closes the licensing loose end, since
// some sources are CC BY / CC BY-SA and need crediting —
// `npm run demo:photos -- --credits` prints it.
//
// `source` is where the picture comes FROM; what gets stored is the copy uploaded
// into the client's own Cloudinary account under `roadmate/shops`.

/**
 * @typedef {object} ShopPhoto
 * @property {string} shop Matches `User.name` exactly. Demo shops exist once per
 *   district, so one name legitimately matches several rows and they all get the
 *   same front — they are the same business in two towns.
 * @property {string} slug Stable Cloudinary id, so a re-run overwrites its own
 *   asset rather than adding another.
 * @property {string} source Where the picture is fetched from, once.
 * @property {string} credit Attribution, for the licences that require it.
 * @property {string} license The licence the source is offered under.
 */

/** @type {ShopPhoto[]} */
export const SHOP_PHOTOS = [

  // ── AUTOMOBILE ────────────────────────────────────────────────────────
  {
    shop: 'Auto World',
    slug: 'auto-world',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/2024_08_07_Knepper_Bros_Auto_Repair_shop.jpg/1280px-2024_08_07_Knepper_Bros_Auto_Repair_shop.jpg',
    credit: 'Rorr404',
    license: 'cc0-1.0'
  },
  {
    shop: 'Speed Motors Garage',
    slug: 'speed-motors-garage',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/HDL_Auto_repair_shop%2C_29_Dec_2025.jpg/1280px-HDL_Auto_repair_shop%2C_29_Dec_2025.jpg',
    credit: 'Andykatib',
    license: 'cc0-1.0'
  },
  {
    shop: 'Kerala Auto Spares',
    slug: 'kerala-auto-spares',
    source: 'https://live.staticflickr.com/65535/49160470978_0fca17bb87_b.jpg',
    credit: 'TheInvertedFan',
    license: 'pdm-1.0'
  },
  {
    shop: 'Mohammad Ali',
    slug: 'mohammad-ali',
    source: 'https://live.staticflickr.com/65535/47939878493_9e81fcd14d.jpg',
    credit: 'Greenville, SC Daily Photo',
    license: 'cc0-1.0'
  },
  {
    shop: 'Panampilly Motors',
    slug: 'panampilly-motors',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Peugeot_205_cabrio_with_open_hood_in_auto_repair_shop.jpg/1280px-Peugeot_205_cabrio_with_open_hood_in_auto_repair_shop.jpg',
    credit: 'Nenad Stojkovic',
    license: 'CC BY 2.0'
  },
  {
    shop: 'Atlantis Auto Spares',
    slug: 'atlantis-auto-spares',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Auto_repair_sign%2C_Roger_Williams_Avenue%2C_Providence.jpg/1280px-Auto_repair_sign%2C_Roger_Williams_Avenue%2C_Providence.jpg',
    credit: 'Kenneth C. Zirkel',
    license: 'CC BY-SA 4.0'
  },
  {
    shop: 'Kakkanad Tyre & Service',
    slug: 'kakkanad-tyre-service',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Texas_Auto_Repair_Body_Shop_03.jpg/1280px-Texas_Auto_Repair_Body_Shop_03.jpg',
    credit: 'WhisperToMe',
    license: 'CC0'
  },
  {
    shop: 'Infopark Car Care',
    slug: 'infopark-car-care',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Texas_Auto_Repair_Body_Shop_01.jpg/1280px-Texas_Auto_Repair_Body_Shop_01.jpg',
    credit: 'WhisperToMe',
    license: 'CC0'
  },
  {
    shop: 'Thrikkakara Auto Point',
    slug: 'thrikkakara-auto-point',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Ingo_gas_station_and_the_auto-repair_shop_in_Brastad.jpg/1280px-Ingo_gas_station_and_the_auto-repair_shop_in_Brastad.jpg',
    credit: 'W.carter',
    license: 'CC BY-SA 4.0'
  },
  {
    shop: 'Edappally Auto Works',
    slug: 'edappally-auto-works',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/AUTO_SOFT_SERVICE_TITAN.jpg/1280px-AUTO_SOFT_SERVICE_TITAN.jpg',
    credit: 'Clementina Ciochina',
    license: 'CC BY-SA 4.0'
  },
  {
    shop: 'Lulu Junction Motors',
    slug: 'lulu-junction-motors',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Forbury_Pharmacy_and_Complete_Auto_Repairs%2C_13_Apr_2026.jpg/1280px-Forbury_Pharmacy_and_Complete_Auto_Repairs%2C_13_Apr_2026.jpg',
    credit: 'Andykatib',
    license: 'CC0'
  },
  {
    shop: 'Vyttila Car Point',
    slug: 'vyttila-car-point',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Dillon%27s_auto_repair_shop%2C_Altus%2C_OK_2024-03-17.jpg/1280px-Dillon%27s_auto_repair_shop%2C_Altus%2C_OK_2024-03-17.jpg',
    credit: 'Xnatedawgx',
    license: 'CC BY-SA 4.0'
  },
  {
    shop: 'Hub Auto Garage',
    slug: 'hub-auto-garage',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Students_at_work_in_auto_repair_shop_-_NARA_-_285366.jpg/1280px-Students_at_work_in_auto_repair_shop_-_NARA_-_285366.jpg',
    credit: 'Unknown authorUnknown author or not provided',
    license: 'Public domain'
  },
  {
    shop: 'Kundannoor Tyres',
    slug: 'kundannoor-tyres',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/GC_Auto_workshop%2C_3_Apr_2026.jpg/1280px-GC_Auto_workshop%2C_3_Apr_2026.jpg',
    credit: 'Andykatib',
    license: 'CC0'
  },
  {
    shop: 'Mavoor Road Motors',
    slug: 'mavoor-road-motors',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Auto_repair_shop%2C_Wiscasset%2C_Maine%2C_US_%28PPL1-Corrected%29_julesvernex2.jpg/1280px-Auto_repair_shop%2C_Wiscasset%2C_Maine%2C_US_%28PPL1-Corrected%29_julesvernex2.jpg',
    credit: 'Jules Verne Times Two',
    license: 'CC BY-SA 4.0'
  },
  {
    shop: 'Calicut Auto Spares',
    slug: 'calicut-auto-spares',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/H%26W_Auto_Repair_-_Aloha%2C_Oregon.JPG/1280px-H%26W_Auto_Repair_-_Aloha%2C_Oregon.JPG',
    credit: 'M.O. Stevens',
    license: 'CC BY-SA 4.0'
  },
  {
    shop: 'Palayam Auto Spares',
    slug: 'palayam-auto-spares',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Car_mechanic_worker_repairing_suspension_of_lifted_automobile_at_auto_repair_garage_shop.jpg/1280px-Car_mechanic_worker_repairing_suspension_of_lifted_automobile_at_auto_repair_garage_shop.jpg',
    credit: 'Shixart1985',
    license: 'CC BY 2.0'
  },
  {
    shop: 'Mananchira Car Care',
    slug: 'mananchira-car-care',
    source: 'https://live.staticflickr.com/7907/47263766131_de3aeeb438_b.jpg',
    credit: 'MyStockPhotos',
    license: 'cc0-1.0'
  },
  {
    shop: 'Beach Road Tyres',
    slug: 'beach-road-tyres',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Car_park_and_workshop_-_geograph.org.uk_-_8071398.jpg/1280px-Car_park_and_workshop_-_geograph.org.uk_-_8071398.jpg',
    credit: 'Richard Law',
    license: 'CC BY-SA 2.0'
  },
  {
    shop: 'Vellimadukunnu Service Hub',
    slug: 'vellimadukunnu-service-hub',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Specialist_car_workshop%2C_Paisley_-_geograph.org.uk_-_6067850.jpg/1280px-Specialist_car_workshop%2C_Paisley_-_geograph.org.uk_-_6067850.jpg',
    credit: 'Richard Dorrell',
    license: 'CC BY-SA 2.0'
  },
  {
    shop: 'Medical College Motors',
    slug: 'medical-college-motors',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Frank_T_Lang_bldg_jeh.jpg/1280px-Frank_T_Lang_bldg_jeh.jpg',
    credit: 'Jim.henderson',
    license: 'cc0-1.0'
  },

  // ── GROCERIES ─────────────────────────────────────────────────────────
  {
    shop: 'Lulu Fresh',
    slug: 'lulu-fresh',
    source: 'https://pd.w.org/2025/01/259678bae96db67a5.43184726-2048x1365.jpg',
    credit: 'Nilo Velez',
    license: 'cc0-1.0'
  },
  {
    shop: 'Green Basket Supermarket',
    slug: 'green-basket-supermarket',
    source: 'https://live.staticflickr.com/5692/23731820012_8b0b90e613_b.jpg',
    credit: 'Open Grid Scheduler / Grid Engine',
    license: 'cc0-1.0'
  },
  {
    shop: 'Daily Needs Mart',
    slug: 'daily-needs-mart',
    source: 'https://live.staticflickr.com/5781/23814128096_a8c4aa5688_b.jpg',
    credit: 'Open Grid Scheduler / Grid Engine',
    license: 'cc0-1.0'
  },

  // ── RESTAURANT ────────────────────────────────────────────────────────
  {
    shop: 'Kuttichira Biryani Center',
    slug: 'kuttichira-biryani-center',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Hijo_De_Su_Madre_%28restaurant%29%2C_interior.JPG/1280px-Hijo_De_Su_Madre_%28restaurant%29%2C_interior.JPG',
    credit: 'Alexis Doine',
    license: 'cc0-1.0'
  },
  {
    shop: 'Paragon Restaurant',
    slug: 'paragon-restaurant',
    source: 'https://pd.w.org/2025/09/86868c398c15a1515.95572308-1536x2048.jpg',
    credit: 'Manjil Aryal',
    license: 'cc0-1.0'
  },
  {
    shop: 'Calicut Kitchen',
    slug: 'calicut-kitchen',
    source: 'https://pd.w.org/2025/03/95867dd383c9eb092.80548902-2048x1365.jpg',
    credit: 'Nilo Velez',
    license: 'cc0-1.0'
  },

  // ── ELECTRONICS ───────────────────────────────────────────────────────
  {
    shop: 'MyG Digital',
    slug: 'myg-digital',
    source: 'https://live.staticflickr.com/65535/54402205979_3435d1bfff_b.jpg',
    credit: 'grandmasterhuon',
    license: 'cc0-1.0'
  },
  {
    shop: 'Cosmos Electronics',
    slug: 'cosmos-electronics',
    source: 'https://live.staticflickr.com/65535/54402400340_0df72cc9b5_b.jpg',
    credit: 'grandmasterhuon',
    license: 'cc0-1.0'
  },
  {
    shop: 'Nandilath G-Mart',
    slug: 'nandilath-g-mart',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Sakuragawa_Electronics_Store_2022-11-13.jpg/1280px-Sakuragawa_Electronics_Store_2022-11-13.jpg',
    credit: 'Asanagi',
    license: 'cc0-1.0'
  },

  // ── TEXTILES ──────────────────────────────────────────────────────────
  {
    shop: 'Lulu Fashion',
    slug: 'lulu-fashion',
    source: 'https://live.staticflickr.com/65535/49174902563_7c88db349d_b.jpg',
    credit: 'Artem Beliaikin',
    license: 'cc0-1.0'
  },
  {
    shop: 'Kalyan Silks',
    slug: 'kalyan-silks',
    source: 'https://live.staticflickr.com/65535/48124880907_71f5366253_b.jpg',
    credit: 'Artem Beliaikin',
    license: 'cc0-1.0'
  },
  {
    shop: 'Trends Kozhikode',
    slug: 'trends-kozhikode',
    source: 'https://live.staticflickr.com/65535/49390481077_b42e83319f_b.jpg',
    credit: 'Artem Beliaikin',
    license: 'cc0-1.0'
  },

  // ── SPORTS ────────────────────────────────────────────────────────────
  {
    shop: 'Decathlon Kozhikode',
    slug: 'decathlon-kozhikode',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Team_Sportia%2C_Ume%C3%A5.jpg/1280px-Team_Sportia%2C_Ume%C3%A5.jpg',
    credit: 'Xanor',
    license: 'cc0-1.0'
  },
  {
    shop: 'Sports Junction',
    slug: 'sports-junction',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Kempeleentie_4_Oulu_20110624.JPG/1280px-Kempeleentie_4_Oulu_20110624.JPG',
    credit: 'Estormiz',
    license: 'cc0-1.0'
  },
  {
    shop: 'Fit Point Store',
    slug: 'fit-point-store',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Dick%27s_Sporting_Goods_7685.jpg/1280px-Dick%27s_Sporting_Goods_7685.jpg',
    credit: 'Chris Light',
    license: 'CC BY-SA 4.0'
  },
];
