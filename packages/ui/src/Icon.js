// Icons, from a real icon set, in one place (2026-08-11).
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// The Rider and Business tab bars drew their icons as **Unicode typographic
// characters** in a `<Text>`: `◉ ▤ ₹ ⛁ ☺ ⌂ ▦ ⇄`. That is worse than it sounds,
// and worse than emoji would have been:
//
//   • **They are font glyphs, so they are whatever the device's font stack has.**
//     `⛁` (U+26C1, white draughts king) and `☺` (U+263A) are outside the subset
//     many Android system fonts ship, so on a real handset they render as a
//     **tofu box** — and which handsets is not something we can test our way out
//     of. A tab bar with a missing glyph is not a rough edge, it is a broken app.
//   • **Their metrics disagree.** Each character has its own advance width,
//     baseline and optical weight, so a row of five never optically aligns no
//     matter what `fontSize` is set — the Cash tab sat visibly lower than Jobs.
//   • **`☺` for "Profile"** reads as a 1990s smiley, which is the single most
//     dated thing on the screen.
//
// The Customer app already used `@expo/vector-icons`. This is the other two
// catching up, and one table so the same concept gets the same icon in all three
// — "Orders" must not be a clipboard in one app and a list in another.
//
// ── WHY THIS IS SAFE TO ADD ─────────────────────────────────────────────────
//
// ⚠️ **No new native module** (HANDOFF §4 — a new one crashes every installed dev
// client until it is rebuilt). `@expo/vector-icons` is JavaScript plus bundled
// TTFs, and its only native dependency is `expo-font`, which **already ships in
// the Expo SDK** and is already present in every one of these dev clients. Nobody
// has to rebuild anything to get these.
import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from './tokens.js';

/**
 * Every icon this platform uses, by what it *means* rather than what it looks
 * like.
 *
 * ⚠️ **Screens name a concept, never an Ionicons string.** That is the whole
 * point of the indirection: "Orders" is one icon across six apps, and changing it
 * is one line here instead of a search across three codebases that will miss one.
 * Adding a raw `<Ionicons name="...">` to a screen is how the drift starts again.
 */
export const ICONS = Object.freeze({
  // Navigation
  home: 'home',
  orders: 'receipt-outline',
  stock: 'cube-outline',
  restock: 'swap-horizontal',
  profile: 'person-circle-outline',
  network: 'git-network-outline',
  earnings: 'wallet-outline',
  cash: 'cash-outline',
  shift: 'radio-button-on',
  search: 'search',
  cart: 'cart',
  offers: 'pricetag-outline',
  voucher: 'ticket-outline',
  addresses: 'location-outline',

  // Actions
  back: 'chevron-back',
  forward: 'chevron-forward',
  close: 'close',
  add: 'add',
  // ⚠️ `remove` is the stepper's **minus sign**, not a delete. `delete` is the
  // bin. They were one word away from being the same icon, and a quantity
  // stepper whose "−" is a rubbish bin is an app nobody taps twice.
  remove: 'remove',
  delete: 'trash-outline',
  edit: 'create-outline',
  camera: 'camera-outline',
  refresh: 'refresh',
  signOut: 'log-out-outline',
  call: 'call-outline',
  navigate: 'navigate-outline',

  // Chrome
  alerts: 'notifications-outline',

  // B2B trade. A `TradeOrder` has a direction — the same distributor is the
  // seller on one row and the buyer on the next (HANDOFF §1) — and these two are
  // how a row says which, without a word of copy.
  outbound: 'arrow-up-outline',
  inbound: 'arrow-down-outline',
  dispatch: 'archive-outline',
  dealers: 'people-outline',
  revenue: 'trending-up-outline',

  // Status
  deliveries: 'checkmark-done',
  allClear: 'checkmark-circle-outline',
  deadRun: 'close-circle-outline',
  prepTime: 'timer-outline',
  success: 'checkmark-circle',
  warning: 'alert-circle',
  danger: 'close-circle',
  info: 'information-circle',
  pending: 'time-outline',
  star: 'star',
  shop: 'storefront-outline',
  rider: 'bicycle-outline',
  document: 'document-text-outline'
});

/**
 * @param {object} props
 * @param {keyof typeof ICONS} props.name a **concept** from `ICONS`.
 * @param {number} [props.size] 20 matches the tab-bar size the glyphs used.
 * @param {string} [props.color]
 */
export function Icon({ name, size = 20, color = colors.ink, style }) {
  const glyph = ICONS[name];
  if (!glyph) {
    // Loud in development, invisible in production: a missing icon must not be a
    // crash in a rider's hand mid-delivery, and must not be silent on my machine.
    if (__DEV__) console.warn(`[ui] unknown icon concept "${name}" — add it to ICONS in Icon.js`);
    return null;
  }
  return <Ionicons name={glyph} size={size} color={color} style={style} />;
}

/**
 * A tab-bar icon. Takes the `{ color }` expo-router hands `tabBarIcon` and
 * nothing else, so a tab is one line and every tab is the same size.
 */
export const TabIcon = (name) => ({ color }) => <Icon name={name} size={22} color={color} />;

/**
 * An icon named by a **table**, not by a screen (2026-08-13).
 *
 * ⚠️ **This is not an escape hatch from `ICONS`, and a screen must never call
 * it.** The rule above still holds: a concept the product has — Orders, Cart,
 * Profile — is one entry in `ICONS` so that six apps cannot drift. This exists
 * for the other case, which `ICONS` cannot serve: artwork chosen per **row of
 * data**. The consumer storefront has seven industries and forty-odd categories,
 * all of them rows a human created, and each needs a picture. Those are not
 * platform concepts and putting them in `ICONS` would bury the twenty icons that
 * are under a hundred that are not.
 *
 * So the taxonomy keeps its own table (`apps/consumer/src/art.js`) and renders it
 * through here. The point of routing it through this file anyway is that the
 * `@expo/vector-icons` import stays in **one** place — swapping icon sets stays a
 * one-file change, which is the actual thing the indirection was protecting.
 *
 * @param {object} props
 * @param {string} props.glyph a raw Ionicons name, from a data-driven art table.
 */
export function VectorIcon({ glyph, size = 24, color = colors.ink, style }) {
  if (!glyph) return null;
  return <Ionicons name={glyph} size={size} color={color} style={style} />;
}
