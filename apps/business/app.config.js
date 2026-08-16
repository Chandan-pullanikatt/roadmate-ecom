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
//   • **Four sets of icons and screenshots.** ⚠️ Still not done — all four
//     variants share `assets/icon.png`, which since 2026-08-13 is the client's
//     wordmark drawn as outlines (see `apps/consumer/app.json`'s icon note). So
//     the four are on-brand and sharp, and are still told apart only by the name
//     under the icon. Screenshots are untouched. Assets only, no code.
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

// ⚠️ **`projectId` is per variant, and it has to be** (2026-08-16). An EAS
// project is identified by its **slug**, and each variant has its own — so
// these four are four EAS projects, not one project built four ways. A single
// id in `app.json` fails every variant but the one it belongs to, with
// "Slug for project identified by extra.eas.projectId (roadmate-shop) does not
// match the slug field (roadmate-manufacturer)".
//
// It lives here rather than in `app.json` for the same reason `slug` and
// `packageId` do: it is per listing. `app.json` deliberately carries **no**
// `extra.eas` block now — a value there applies to all four and is what caused
// the failure.
//
// **Filling in a missing one.** Leave it `null` and run the build. EAS finds or
// offers to create the project for that slug, prints its id, and then stops
// with "Cannot automatically write to dynamic config at: app.config.js" —
// because this file is a *dynamic* config and EAS only ever auto-writes into a
// static `app.json`. That is not a failure to work around: it is EAS handing
// you the id and asking you to put it where it belongs. Paste it into the row
// below and re-run. One-time, per variant.
const VARIANTS = {
  shop: {
    name: 'RoadMate Shop',
    slug: 'roadmate-shop',
    scheme: 'roadmate-shop',
    packageId: 'com.roadmate.shop',
    projectId: '2fb32e6b-9c86-406f-8ae7-9e417a6b325e',
    // Must match the role strings the API returns on `user.role`.
    roles: ['SHOP'],
    tagline: 'For shop owners'
  },
  manufacturer: {
    name: 'RoadMate Manufacturer',
    slug: 'roadmate-manufacturer',
    scheme: 'roadmate-manufacturer',
    packageId: 'com.roadmate.manufacturer',
    projectId: '5a71b111-ff87-44f6-995e-d1e2e17340d9',
    roles: ['MANUFACTURER'],
    tagline: 'For manufacturers'
  },
  distributor: {
    name: 'RoadMate Distributor',
    slug: 'roadmate-distributor',
    scheme: 'roadmate-distributor',
    packageId: 'com.roadmate.distributor',
    projectId: null,
    roles: ['DISTRIBUTOR'],
    tagline: 'For distributors'
  },
  regional: {
    name: 'RoadMate Regional',
    slug: 'roadmate-regional',
    scheme: 'roadmate-regional',
    packageId: 'com.roadmate.regional',
    projectId: null,
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
 * Where this variant's launcher art lives (2026-08-13).
 *
 * ⚠️ Icons are the one asset that is **per listing** rather than shared, which
 * is why they are the only path this file rewrites. Everything else in
 * `app.json` — plugins, splash, newArch, the API url — stays written down once,
 * exactly as before.
 *
 * All four are the same wordmark on the same brand field; they differ by a small
 * role badge under it. That is a launcher problem, not a branding one: a client
 * running the demo has all six RoadMate apps installed at once, and six
 * identical tiles are told apart only by a label Android truncates to about
 * twelve characters — "RoadMate Man…" and "RoadMate Reg…" side by side.
 */
const art = (file) => `./assets/variants/${variantKey}/${file}`;

/**
 * `config` is `app.json`, which Expo passes in — so everything shared (plugins,
 * splash, newArch, the API url) stays written down exactly once.
 */
export default ({ config }) => ({
  ...config,
  name: variant.name,
  slug: variant.slug,
  scheme: variant.scheme,
  icon: art('icon.png'),
  ios: { ...config.ios, bundleIdentifier: variant.packageId },
  android: {
    ...config.android,
    package: variant.packageId,
    adaptiveIcon: {
      ...config.android.adaptiveIcon,
      foregroundImage: art('android-icon-foreground.png'),
      backgroundImage: art('android-icon-background.png'),
      monochromeImage: art('android-icon-monochrome.png')
    }
  },
  web: { ...config.web, favicon: art('favicon.png') },
  extra: {
    ...config.extra,
    // Which EAS project this listing builds into. Omitted entirely rather than
    // set to null when the variant has no id yet — an `eas` key present but
    // empty reads as a broken link, whereas its absence is what makes EAS offer
    // to set the project up and print the id. See the note on `VARIANTS`.
    ...(variant.projectId ? { eas: { projectId: variant.projectId } } : {}),
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
