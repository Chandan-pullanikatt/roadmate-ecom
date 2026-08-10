// The design system, as values. HANDOFF §5 is the source; this file is the only
// place any of its numbers or colours are written down.
//
// Nothing below is app-specific. All three apps (Business, Rider, Consumer) read
// the same tokens, because the three of them are one product to the shops and
// riders who use two of them in the same shift.

export const colors = {
  // The accent. Confirmed with the client: primary buttons, the active tab,
  // selected chips, quantity steppers. It is a mid-tone yellow, so text on it is
  // always `ink`, never white — see `onAccent`.
  accent: '#DEBE10',
  accentSoft: '#FBF3C8', // selected-chip fill, stepper background
  accentDim: '#F6E9A0',
  onAccent: '#1A1A1A',

  // Status. HANDOFF §5: green = delivered/active/healthy, amber =
  // packed/pending, blue = dispatched/route cards, red = cancelled/log out.
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  info: '#2563EB',
  infoSoft: '#DBEAFE',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',

  // Surfaces. Cards are white on a very light grey page, which is what gives the
  // soft-shadow card its edge without a border.
  page: '#F5F6F8',
  card: '#FFFFFF',
  border: '#E6E8EC',

  ink: '#1A1A1A', // titles, money
  inkMuted: '#6B7280', // meta lines, SKU caps
  inkFaint: '#9CA3AF' // placeholders, disabled labels
};

/** The 4-point scale everything is laid out on. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 };

/**
 * The banner palettes (the storefront pass, 2026-08-10).
 *
 * ⚠️ **`Banner.theme` stores a key from this table and never a hex code.** A
 * colour in the database is a banner nobody can restyle, that ignores every
 * decision this file makes, and that no accessibility pass can reach — and the
 * server refuses an unknown key (`BANNER_THEMES` in `merchandisingController.js`)
 * so the typo fails in front of whoever made the banner rather than as an
 * unstyled grey card on a customer's home screen. The two lists are one thing in
 * two files and a server test pins them equal.
 *
 * Each entry carries its own text colours rather than assuming ink, because
 * `ink` is a dark card and the same yellow-on-white rule that governs `onAccent`
 * governs this: contrast is a property of the pair, not of the background.
 */
export const bannerThemes = {
  sunrise: { from: '#FEF6D4', to: '#F6DE79', ink: '#1A1A1A', sub: '#5C5326', button: '#1A1A1A', onButton: '#FFFFFF' },
  mint:    { from: '#E6F8EC', to: '#B3E9C6', ink: '#12331F', sub: '#3D6B4E', button: '#12331F', onButton: '#FFFFFF' },
  sky:     { from: '#E6F2FE', to: '#BADCF9', ink: '#0F2A44', sub: '#3E617F', button: '#0F2A44', onButton: '#FFFFFF' },
  blush:   { from: '#FEEDED', to: '#FBCDD0', ink: '#41161A', sub: '#7A4449', button: '#41161A', onButton: '#FFFFFF' },
  lilac:   { from: '#F1EBFE', to: '#D5C6FB', ink: '#2A1B4D', sub: '#5A4A80', button: '#2A1B4D', onButton: '#FFFFFF' },
  ink:     { from: '#2E333B', to: '#14171C', ink: '#FFFFFF', sub: '#B6BDC7', button: '#DEBE10', onButton: '#1A1A1A' }
};

/** The palette a banner with no `theme` gets. Never a crash, never a grey card. */
export const DEFAULT_BANNER_THEME = 'sunrise';

export const bannerTheme = (key) => bannerThemes[key] ?? bannerThemes[DEFAULT_BANNER_THEME];

/**
 * Tile tints for the industry and category rails.
 *
 * Soft, low-chroma fills so a row of seven does not read as a row of buttons —
 * the artwork is the subject and the tile is the frame it sits in. Keyed by
 * position rather than by industry, because the platform's taxonomy is data and
 * a colour table that had to grow a row per industry would be one more thing to
 * edit when the client adds an eighth.
 */
export const tileTints = [
  '#FFF4CC', '#E6F8EC', '#E6F2FE', '#FEEDED', '#F1EBFE', '#FDF0E3', '#E8F6F6'
];

export const tileTint = (index) => tileTints[Math.abs(index) % tileTints.length];

export const typography = {
  screenTitle: { fontSize: 22, fontWeight: '700', color: colors.ink },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  body: { fontSize: 14, color: colors.ink },
  meta: { fontSize: 12, color: colors.inkMuted },
  // "SKU in small grey caps above the product name" (HANDOFF §5). 11, not 10:
  // Material's smallest defined size is 11 (labelSmall) and Android's own
  // accessibility guidance treats anything under it as too small to set text in.
  // The letter-spacing is what keeps it reading as a caps label rather than
  // shrunken body text.
  sku: { fontSize: 11, fontWeight: '600', color: colors.inkMuted, letterSpacing: 0.8 },
  money: { fontSize: 16, fontWeight: '700', color: colors.ink }
};

/** The card shadow, spelled for both platforms. */
export const shadow = {
  shadowColor: '#0B1220',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2
};

/**
 * A deeper shadow, for the two things that sit *above* the page rather than on
 * it: a banner in a carousel and the sticky cart bar.
 *
 * Deliberately one step, not a scale of six. Two elevations that both mean
 * "raised" are a decision nobody can make consistently; the rule here is simply
 * whether the element scrolls with the page (`shadow`) or floats over it
 * (`shadowLift`).
 */
export const shadowLift = {
  shadowColor: '#0B1220',
  shadowOpacity: 0.14,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 6 },
  elevation: 8
};

/**
 * Status pill colours, keyed by the strings the API actually returns.
 *
 * The consumer-order statuses are `ConsumerOrderStatus`; the trade-order ones
 * are the B2B controller's capitalised strings ("Pending", "Dispatched"). Both
 * appear in this app — the shop sells with one and buys with the other — so both
 * are mapped here rather than in two places that would drift.
 */
const STATUS_TONES = {
  // B2C — ConsumerOrder
  PLACED: 'info',
  ROUTING: 'info',
  OFFERED: 'warning',
  ACCEPTED: 'info',
  PREPARING: 'warning',
  READY: 'warning',
  PICKED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',

  // B2B — TradeOrder
  Pending: 'warning',
  Approved: 'info',
  Packed: 'warning',
  Dispatched: 'info',
  Delivered: 'success',
  Cancelled: 'danger',

  // B2B — Payout. Shares "Pending" with TradeOrder, which is the same amber in
  // both vocabularies, so the overlap is harmless.
  Settled: 'success',
  Failed: 'danger'
};

export function statusTone(status) {
  return STATUS_TONES[status] ?? 'neutral';
}

/** `{ bg, fg }` for a pill of the given tone. */
export function toneColors(tone) {
  switch (tone) {
    case 'success':
      return { bg: colors.successSoft, fg: colors.success };
    case 'warning':
      return { bg: colors.warningSoft, fg: colors.warning };
    case 'info':
      return { bg: colors.infoSoft, fg: colors.info };
    case 'danger':
      return { bg: colors.dangerSoft, fg: colors.danger };
    case 'accent':
      return { bg: colors.accentSoft, fg: colors.onAccent };
    default:
      return { bg: colors.page, fg: colors.inkMuted };
  }
}
