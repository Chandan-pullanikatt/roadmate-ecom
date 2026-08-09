// Where the API is.
//
// `localhost` is the one value that is always wrong on a physical device: the
// phone resolves it to itself. In development the URL must be the dev machine's
// LAN address, which is why this reads an env var first — `EXPO_PUBLIC_*` is
// inlined into the bundle by Expo and needs no config-plugin work.
import Constants from 'expo-constants';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants.expoConfig?.extra?.apiUrl ??
  'http://localhost:5000';

/**
 * How often a list re-asks the server.
 *
 * The whole pipeline is pollable by design (PLAN §6), so nothing here is blocked
 * on push — but the offers list is the one screen where latency is the product:
 * a 60-second window polled every 10 seconds can burn a sixth of itself before
 * the shop has seen the order. Push replaces the *notification*, not this poll;
 * the list still needs to be right when the shop opens it.
 */
export const POLL_MS = {
  offers: 5000,
  orders: 15000,
  stock: 60000,
  // Who is on shift changes when somebody taps a button in another app, so it
  // is worth re-asking — but a delivery roster is three or four people, not a
  // queue with a countdown on it.
  riders: 30000,
  // An executive dashboard is a reporting surface, not a live queue: nothing on
  // it expires, and a B2B order moves on a human timescale of hours. Polling it
  // at the shop's rate would be traffic with nothing to show for it.
  overview: 60000
};
