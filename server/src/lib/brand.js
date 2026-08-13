// The handful of brand values the **server** needs, because it renders exactly
// one customer-facing surface: the hosted checkout page (`checkoutPage.js`).
//
// ⚠️ `packages/ui/src/tokens.js` is the source of truth for every one of these,
// and the server cannot import it — `packages/*` is an npm workspace of the
// three apps and `server/` deliberately sits outside it (HANDOFF §2), so this is
// a copy. Six values, copied on purpose rather than by adding the server to the
// workspace for a stylesheet.
//
// If the accent ever changes, it changes in `tokens.js` first and here second.
// A payment page in last season's yellow is the kind of thing nobody notices
// until a customer does.
export const colors = Object.freeze({
  accent: '#DEBE10',
  onAccent: '#1A1A1A',
  ink: '#1A1A1A',
  inkMuted: '#6B7280',
  danger: '#DC2626',
  pageBg: '#F5F6F8',
  surface: '#FFFFFF'
});
