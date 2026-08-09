// @roadmate/hooks — the React behaviour all three apps share.
//
// Unlike `@roadmate/ui` (no navigation) and `@roadmate/api` (no React), this
// package is deliberately a *runtime* one: it depends on React and expo-router.
// That is exactly why it did not exist until Phase 4 — see `useResource.js`.
export { useResource } from './useResource.js';
