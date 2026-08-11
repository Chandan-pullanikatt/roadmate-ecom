// @roadmate/ui — HANDOFF §5's design system, as code.
//
// Everything visual that more than one screen uses lives here, so the three apps
// stay one product. If a screen is reaching past this package for a colour or a
// radius, the token is missing — add it here rather than inlining it there.
export * from './tokens.js';
export * from './money.js';
// The mark, and the icon set (2026-08-11). Both were per-app before: the Customer
// app had the real logo and `@expo/vector-icons` while Rider and Business had a
// yellow square and Unicode characters standing in for icons. Shared here so the
// three apps are one product, which is what they are to anybody using two of them.
export * from './Brand.js';
export * from './Icon.js';
// The "am I earning right now" switch, shared by the Rider's shift and the Shop's
// open/closed. Same meaning, same stakes, one component (2026-08-11).
export * from './StateToggle.js';
export * from './primitives.js';
export * from './layout.js';
export * from './Button.js';
export * from './Countdown.js';
export * from './QuantityStepper.js';
export * from './SearchField.js';
export * from './Banner.js';
export * from './Gradient.js';
export * from './Skeleton.js';
export * from './GroupedCard.js';
export * from './OrderCard.js';
export * from './StickyFooter.js';
