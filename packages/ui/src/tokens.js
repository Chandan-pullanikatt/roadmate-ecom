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

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

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
