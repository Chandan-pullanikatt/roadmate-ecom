// Which of the four shipped apps this build is (see `app.config.js`).
//
// `RoadMate Shop`, `RoadMate Manufacturer`, `RoadMate Distributor` and
// `RoadMate Regional` are one codebase built four times (HANDOFF §4, revised
// 2026-08-08). This module is the runtime half of that: it answers "is this
// person's role served by the app they just installed?", so the door can say
// **"you have the wrong app, install this one"** instead of signing them in to
// a set of empty tabs.
//
// That message matters more now, not less. Every partner is onboarded by a
// field executive who tells them what to download, and with four business
// listings there are more ways to be told wrong. "Wrong app" plus the right
// app's name is a thirty-second fix; a working login with nothing in it is a
// support call.
import Constants from 'expo-constants';

/** Every role the Business codebase can serve, across all variants. */
const ALL_BUSINESS_ROLES = ['SHOP', 'DISTRIBUTOR', 'MANUFACTURER', 'REGIONAL'];

/**
 * One role, one app — the whole of the 2026-08-08 split, as a table.
 *
 * This is the single mapping from "who you are" to "what you should have
 * installed", and it is what both the door and any future deep-link handler
 * read. A fifth business listing is a row here and a row in `app.config.js`.
 */
const APP_FOR_ROLE = {
  SHOP: 'RoadMate Shop',
  MANUFACTURER: 'RoadMate Manufacturer',
  DISTRIBUTOR: 'RoadMate Distributor',
  REGIONAL: 'RoadMate Regional',
  // Not this codebase — `apps/rider` (Phase 3). Named anyway, because a
  // delivery partner handed the wrong app needs the same thirty-second fix.
  EXECUTIVE: 'RoadMate Rider'
};

/**
 * Falls back to serving **every** role when no variant is configured — which is
 * exactly how the single combined app behaved before the split. An older build,
 * a bare `expo start` without the env var, or a stripped config therefore
 * degrades to "let them in", never to "lock everyone out".
 */
const configured = Constants.expoConfig?.extra?.variant ?? null;

export const VARIANT = {
  key: configured?.key ?? 'all',
  name: configured?.name ?? 'RoadMate Business',
  roles: configured?.roles ?? ALL_BUSINESS_ROLES,
  tagline: configured?.tagline ?? 'For shops and business partners'
};

/** Does this build serve that role? */
export const servesRole = (role) => VARIANT.roles.includes(role);

/**
 * Which app this person should have instead, by name — or null if we do not
 * know of one. Deliberately a plain lookup and not a deep link: we cannot know
 * the other app is installed, and a dead link is worse than a name they can
 * search for.
 */
export function appForRole(role) {
  return APP_FOR_ROLE[role] ?? null;
}
