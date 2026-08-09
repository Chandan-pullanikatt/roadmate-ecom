// Money, and the one rule about it.
//
// B2C money is `Decimal(12,2)` in Postgres and arrives from the API as a
// **fixed-2 string** ("294.00"), serialised by `toMoney()` on the server. It must
// never be turned into a JS number to do arithmetic with: `0.1 + 0.2` is the
// oldest bug in retail software, and the backend went to the trouble of using
// Decimal precisely so the client would not reintroduce it. So:
//
//   • `formatINR` formats a string by manipulating the string. No parseFloat.
//   • `addMoney` / `mulMoney` work in integer paise and hand back a fixed-2
//     string, so a running total stays exact.
//   • `toNumber` exists, is named to be conspicuous, and is for *comparisons and
//     charts only* — never for a figure that will be displayed or sent back.
//
// B2B money is a different thing: `TradeOrder.totalAmount` is deliberately still
// a `Float` (a server test enforces it, because 7 dashboards read those columns),
// so it arrives as a JS number. `formatAmount` handles both shapes, and the two
// halves of this app genuinely do meet — the shop sells with the first and
// restocks with the second.

/** The character the designs get wrong on executive screens. Everything is ₹. */
export const RUPEE = '₹';

/** "1234567.89" → "12,34,567.89". Indian grouping: last 3, then 2s. */
function groupIndian(intPart) {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** Split a fixed-2 money string into sign, rupees and paise. Tolerant of "12", "12.5". */
function parts(value) {
  const raw = String(value ?? '0').trim();
  const negative = raw.startsWith('-');
  const digits = raw.replace(/^[-+]/, '');
  const [int = '0', frac = ''] = digits.split('.');
  return {
    negative,
    int: (int.replace(/\D/g, '') || '0').replace(/^0+(?=\d)/, ''),
    frac: `${frac.replace(/\D/g, '')}00`.slice(0, 2)
  };
}

/**
 * Format a fixed-2 money **string** for display. The string is never parsed.
 *
 * @param {string} value e.g. "294.00"
 * @param {{paise?: boolean, sign?: boolean}} [options] `paise: false` drops
 *   ".00" for tidy stat tiles; `sign: false` drops the ₹.
 */
export function formatINR(value, options = {}) {
  const { paise = true, sign = true } = options;
  const { negative, int, frac } = parts(value);
  const body = paise ? `${groupIndian(int)}.${frac}` : groupIndian(int);
  return `${negative ? '-' : ''}${sign ? RUPEE : ''}${body}`;
}

/** Money → integer paise, exactly, without ever touching a float. */
function toPaise(value) {
  const { negative, int, frac } = parts(value);
  const n = BigInt(int) * 100n + BigInt(frac);
  return negative ? -n : n;
}

/** Integer paise → fixed-2 string. */
function fromPaise(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const int = abs / 100n;
  const frac = String(abs % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

/** Exact sum of any number of money strings, as a money string. */
export function addMoney(...values) {
  return fromPaise(values.reduce((sum, v) => sum + toPaise(v), 0n));
}

export function subMoney(a, b) {
  return fromPaise(toPaise(a) - toPaise(b));
}

/**
 * Money × a whole count — a line total, which is the only multiplication a
 * client screen ever legitimately does. Fractional multipliers (a percentage, a
 * commission) are the server's job: those are the numbers that must agree with
 * what was written to the ledger, and recomputing them here would produce a
 * second, disagreeing answer.
 */
export function mulMoney(value, count) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) throw new Error('mulMoney takes a whole, non-negative count');
  return fromPaise(toPaise(value) * BigInt(n));
}

/** Exact comparison. -1, 0 or 1. */
export function compareMoney(a, b) {
  const pa = toPaise(a);
  const pb = toPaise(b);
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

export const isZeroMoney = (value) => toPaise(value) === 0n;

/**
 * For sorting, charting and width calculations **only**.
 *
 * Named to be awkward on purpose: anything that ends up back on screen or back
 * on the wire should have gone through `formatINR` / `addMoney` instead.
 */
export function toNumberForDisplayOnly(value) {
  return Number(toPaise(value)) / 100;
}

/**
 * Format either shape: a B2C money string or a B2B `Float`.
 *
 * A number is formatted through `toFixed(2)` — safe, because it is already a
 * float and this is the last thing that happens to it. Reaching for this instead
 * of `formatINR` on a B2C value would be the mistake; the B2C endpoints all
 * return strings, so `typeof` tells them apart reliably.
 */
export function formatAmount(value, options) {
  return formatINR(typeof value === 'number' ? value.toFixed(2) : value, options);
}

/** "12,300" for a stat tile that has no room for paise. */
export const formatCompact = (value) => formatAmount(value, { paise: false });
