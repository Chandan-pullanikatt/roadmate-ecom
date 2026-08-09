// `npm run config:apply` — the client's confirmed commercial decisions, written
// as `PlatformConfig` rows.
//
// The distinction this file protects is the one the script exists for: a
// *default* is what the code does when nobody has said anything, and a *row* is
// a thing a human chose. Two things must stay true of it:
//   · it is idempotent, because it will be re-run every time a number changes
//   · a per-industry override is a real row, not the global row read back
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedBaseline, prisma, disconnect } from './helpers/db.js';
import { applyConfirmedConfig } from '../src/jobs/applyConfirmedConfig.js';
import { getConfigNumber, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import { riderEarningFor } from '../src/lib/riderPay.js';

const quiet = { log: () => {} };

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  await seedBaseline();
});

after(async () => {
  await disconnect();
});

test('the confirmed numbers land as rows, not defaults', async () => {
  await applyConfirmedConfig(quiet);

  // From designs/Partner.png's own bill panel: ₹125 + ₹6.25 tax + ₹25 delivery
  // = ₹156.25, so tax is 5% and the delivery fee is ₹25.
  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT), 5);
  assert.equal(await getConfigNumber(CONFIG_KEYS.DELIVERY_FEE), 25);

  // ⚠️ **ZERO, changed from 15 on the client call of 2026-08-09.** The platform
  // takes no cut of any consumer order — its income is the three partner
  // subscriptions, and GST belongs to the shop. This assertion is the alarm: if
  // it ever reads 15 again, somebody has reinstated a commission the client
  // removed, and every settlement after that point is wrong.
  assert.equal(await getConfigNumber(CONFIG_KEYS.COMMISSION_PERCENT), 0);
});

test('a wasted trip pays the rider, and is not silently free', async () => {
  await applyConfirmedConfig(quiet);

  // ⚠️ ₹25, confirmed 2026-08-09. Before this it had no confirmed figure and
  // defaulted to 0, so a rider who made the journey and found nobody there was
  // paid nothing at all — they bore the whole cost of the customer's no-show.
  assert.equal(await getConfigNumber(CONFIG_KEYS.DEAD_RUN_FEE), 25);
});

test('the delivery fee does not cover the rider beyond the free radius', async () => {
  // Not a bug — a *recorded consequence*, so it cannot be rediscovered as a
  // surprise. `delivery_fee` is flat and rider pay grows with distance, and with
  // commission now 0 there is nothing else on a consumer order that earns. The
  // platform therefore breaks even at exactly `rider_free_km` and loses
  // `rider_per_km_fee` for every kilometre after it. The client was shown these
  // figures on 2026-08-09 and confirmed. If the fix ever lands it is a
  // distance-based delivery fee, which is config and not code.
  await applyConfirmedConfig(quiet);

  const fee = await getConfigNumber(CONFIG_KEYS.DELIVERY_FEE);
  const [baseFee, freeKm, perKmFee] = await Promise.all([
    getConfigNumber(CONFIG_KEYS.RIDER_BASE_FEE),
    getConfigNumber(CONFIG_KEYS.RIDER_FREE_KM),
    getConfigNumber(CONFIG_KEYS.RIDER_PER_KM_FEE)
  ]);
  const payFor = (km) => Number(riderEarningFor({ distanceKm: km, baseFee, freeKm, perKmFee }).total);

  assert.equal(fee - payFor(2), 0);    // break-even, exactly at the free radius
  assert.equal(fee - payFor(5), -24);  // ₹24 out of pocket on a 5 km drop
  assert.equal(fee - payFor(8), -48);
});

test('rider pay is the rate the client gave on the call', async () => {
  await applyConfirmedConfig(quiet);

  assert.equal(await getConfigNumber(CONFIG_KEYS.RIDER_BASE_FEE), 25);
  assert.equal(await getConfigNumber(CONFIG_KEYS.RIDER_FREE_KM), 2);
  assert.equal(await getConfigNumber(CONFIG_KEYS.RIDER_PER_KM_FEE), 8);

  // The figure that matters, end to end: a 5 km delivery pays
  // ₹25 + (5 − 2) × ₹8. If this number ever changes without a client call,
  // something has quietly repriced every rider on the platform.
  const earning = riderEarningFor({
    distanceKm: 5,
    baseFee: await getConfigNumber(CONFIG_KEYS.RIDER_BASE_FEE),
    freeKm: await getConfigNumber(CONFIG_KEYS.RIDER_FREE_KM),
    perKmFee: await getConfigNumber(CONFIG_KEYS.RIDER_PER_KM_FEE)
  });
  assert.equal(earning.total.toFixed(2), '49.00');
});

test('the subscription fees are the ones from the call, not the old constants', async () => {
  await applyConfirmedConfig(quiet);

  // ⚠️ Two of these three changed on 2026-08-07, and one changed downwards:
  // the old hardcoded pair was shop 5000 / distributor 10000.
  assert.equal(await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP), 3000);
  assert.equal(await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR), 5000);
  assert.equal(await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER), 10000);
});

test('a partner fee the script has not written is nothing, not a guess', async () => {
  // No `applyConfirmedConfig` here — this is a database nobody has told.
  //
  // The three fees have no code default on purpose. They used to (5000/10000),
  // and those were the *wrong* numbers for months without anything looking
  // broken. A fee is a thing a human said, or it is "—".
  for (const key of [
    CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP,
    CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR,
    CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER
  ]) {
    assert.equal(await prisma.platformConfig.count({ where: { key } }), 0);
    assert.equal(await getConfigNumber(key), null, `${key} must not invent a price`);
  }
});

test('GST is per industry — one flat rate across seven of them would be wrong', async () => {
  const restaurant = await prisma.industry.create({
    data: { name: 'Restaurant', slug: 'restaurant', fulfilmentType: 'COOK_AND_DELIVER' }
  });
  const gym = await prisma.industry.create({
    data: { name: 'Gym', slug: 'gym', fulfilmentType: 'NO_DELIVERY' }
  });

  await applyConfirmedConfig(quiet);

  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT, restaurant.id), 5);
  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT, gym.id), 18);

  // Each is its own row, not the global one resolved through.
  const override = await prisma.platformConfig.findFirst({
    where: { key: CONFIG_KEYS.TAX_PERCENT, industryId: gym.id }
  });
  assert.equal(override.value, '18');
});

test('an industry the platform does not have yet is skipped, never created', async () => {
  const before = await prisma.industry.count();
  await applyConfirmedConfig(quiet);

  assert.equal(await prisma.industry.count(), before);
  // seedBaseline's industry is slug 'grocery'; the map's key is 'groceries'.
  // A near-miss must not silently become a global write.
  const rows = await prisma.platformConfig.count({
    where: { key: CONFIG_KEYS.TAX_PERCENT, industryId: { not: null } }
  });
  assert.equal(rows, 0);
});

test('re-running changes nothing and duplicates nothing', async () => {
  const industry = await prisma.industry.create({
    data: { name: 'Gym', slug: 'gym', fulfilmentType: 'NO_DELIVERY' }
  });

  await applyConfirmedConfig(quiet);
  await applyConfirmedConfig(quiet);

  // One global row per key is the invariant Postgres cannot enforce (NULLs are
  // distinct), so `setConfig` has to — and this is what proves it does.
  assert.equal(
    await prisma.platformConfig.count({ where: { key: CONFIG_KEYS.TAX_PERCENT, industryId: null } }),
    1
  );
  assert.equal(
    await prisma.platformConfig.count({ where: { key: CONFIG_KEYS.TAX_PERCENT, industryId: industry.id } }),
    1
  );
  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT, industry.id), 18);
});

test('a hand-edited value is overwritten, because the script is the record', async () => {
  await applyConfirmedConfig(quiet);
  const row = await prisma.platformConfig.findFirst({
    where: { key: CONFIG_KEYS.DELIVERY_FEE, industryId: null }
  });
  await prisma.platformConfig.update({ where: { id: row.id }, data: { value: '999' } });

  const applied = await applyConfirmedConfig(quiet);

  assert.equal(await getConfigNumber(CONFIG_KEYS.DELIVERY_FEE), 25);
  // And it reports what it changed, so a re-run is not a silent write.
  const entry = applied.find((a) => a.key === CONFIG_KEYS.DELIVERY_FEE && !a.industryId);
  assert.equal(entry.before, '999');
});
