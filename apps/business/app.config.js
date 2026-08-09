// Four shipped apps, one codebase (HANDOFF §4, revised 2026-08-08).
//
//   RoadMate Shop          — shop owners
//   RoadMate Manufacturer  — manufacturers
//   RoadMate Distributor   — distributors
//   RoadMate Regional      — regional partners
//
// ⚠️ **This replaces the 2026-08-07 "RoadMate Partner" single listing.** The
// client's decision: each business role gets its own app, so the platform ships
// **six** listings in total — these four, plus RoadMate (customers) and RoadMate
// Rider. Six apps, still **three** codebases.
//
// These are **Expo app variants**, not four projects. `app.json` holds
// everything the builds share; this file overrides only the four things that
// make them separate Play Store listings — name, slug, scheme and package id —
// plus the list of roles the build is for. Everything underneath
// (`packages/ui`, `packages/api`, the API, the session, `src/roles.js`, the
// whole `(exec)` section) is shared and is not duplicated per listing.
//
// Why splitting is nearly free here: the three partner roles never differed by
// *screen*, only by which endpoints return something, and that difference has
// always lived in `src/roles.js` as a table. So a listing is a row in this file
// and a role is a row in that one. Neither is a codebase. Going from two
// listings to four touched no screen.
//
// What it does cost, and these are real:
//   • **Every release is four Play Store submissions** for this codebase.
//   • **Four sets of icons and screenshots.** ⚠️ Still not done — all variants
//     share `assets/icon.png`. Assets only, no code.
//   • **Being told the wrong app** is now likelier, not less: a field executive
//     hands out the name and there are four to confuse. `src/variant.js` plus
//     the door is what makes that a thirty-second fix — a distributor who
//     installs RoadMate Manufacturer is told, by name, which one to install.
//
// Usage:
//   APP_VARIANT=shop         npx expo start   (or `npm run shop`)
//   APP_VARIANT=manufacturer npx expo start   (or `npm run manufacturer`)
//   APP_VARIANT=distributor  npx expo start   (or `npm run distributor`)
//   APP_VARIANT=regional     npx expo start   (or `npm run regional`)
//
// ⚠️ The package id is what the Play Store treats as identity. Once a build is
// published under `com.roadmate.shop`, that string can never change — it is the
// app. Do not "tidy" these.
//
// ⚠️ `com.roadmate.partner` is **retired, not renamed.** It was never published,
// so nothing is stranded; but if it ever is, it cannot become one of the three
// below. A package id is an app, and three apps cannot be one.

const VARIANTS = {
  shop: {
    name: 'RoadMate Shop',
    slug: 'roadmate-shop',
    scheme: 'roadmate-shop',
    packageId: 'com.roadmate.shop',
    // Must match the role strings the API returns on `user.role`.
    roles: ['SHOP'],
    tagline: 'For shop owners'
  },
  manufacturer: {
    name: 'RoadMate Manufacturer',
    slug: 'roadmate-manufacturer',
    scheme: 'roadmate-manufacturer',
    packageId: 'com.roadmate.manufacturer',
    roles: ['MANUFACTURER'],
    tagline: 'For manufacturers'
  },
  distributor: {
    name: 'RoadMate Distributor',
    slug: 'roadmate-distributor',
    scheme: 'roadmate-distributor',
    packageId: 'com.roadmate.distributor',
    roles: ['DISTRIBUTOR'],
    tagline: 'For distributors'
  },
  regional: {
    name: 'RoadMate Regional',
    slug: 'roadmate-regional',
    scheme: 'roadmate-regional',
    packageId: 'com.roadmate.regional',
    roles: ['REGIONAL'],
    tagline: 'For regional partners'
  }
};

// Defaults to `shop` for local development — the largest, busiest and most
// complex of the four, so it is the one worth having in front of you by default.
const variantKey = process.env.APP_VARIANT || 'shop';
const variant = VARIANTS[variantKey];

if (!variant) {
  throw new Error(
    `Unknown APP_VARIANT "${variantKey}". Expected one of: ${Object.keys(VARIANTS).join(', ')}.` +
      (variantKey === 'partner'
        ? ' "partner" was retired on 2026-08-08 — manufacturers, distributors and regional' +
          ' partners now each have their own app (HANDOFF §4).'
        : '')
  );
}

/**
 * `config` is `app.json`, which Expo passes in — so everything shared (icons,
 * plugins, splash, newArch, the API url) stays written down exactly once.
 */
export default ({ config }) => ({
  ...config,
  name: variant.name,
  slug: variant.slug,
  scheme: variant.scheme,
  ios: { ...config.ios, bundleIdentifier: variant.packageId },
  android: { ...config.android, package: variant.packageId },
  extra: {
    ...config.extra,
    // Read at runtime by `src/variant.js`. The roles list travels with the
    // build so the door can tell someone they have the wrong app *before* they
    // wonder why it is empty.
    variant: {
      key: variantKey,
      name: variant.name,
      roles: variant.roles,
      tagline: variant.tagline
    }
  }
});
