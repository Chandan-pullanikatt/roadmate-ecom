// Phase 2 — Expo Push. The only thing between the shop app and a real
// counter: a 60-second accept timer nobody's phone buzzes for always expires.
//
// Expo Push needs no account credentials, so there is no "unconfigured" state
// to gate on the way `razorpay.js` gates on missing keys. The stub-without-
// credentials shape still applies — no test may make a network call — so this
// stubs on `NODE_ENV === 'test'` instead, which `tests/helpers/env.js` always
// sets.
import prisma from './prisma.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const isLive = () => process.env.NODE_ENV !== 'test';

/**
 * Send Expo push messages, then flip `isActive` off for any device Expo
 * reports as `DeviceNotRegistered` — otherwise an uninstalled app's token
 * lives forever and every future send keeps hitting it.
 *
 * @param {{to:string, title:string, body:string, data?:object}[]} messages
 */
export async function sendPushNotifications(messages) {
  if (!messages.length) return { tickets: [] };
  if (!isLive()) return { stub: true, tickets: [] };

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages)
  });
  const body = await res.json().catch(() => null);
  const tickets = body?.data ?? [];

  const deadTokens = tickets
    .map((ticket, i) => (ticket?.details?.error === 'DeviceNotRegistered' ? messages[i]?.to : null))
    .filter(Boolean);

  if (deadTokens.length) {
    await prisma.deviceToken.updateMany({
      where: { token: { in: deadTokens } },
      data: { isActive: false }
    });
  }

  return { tickets };
}

/**
 * Push every active device a staff user (shop, rider, exec) has registered —
 * a shop counter may have more than one phone signed in.
 */
export async function notifyUser(userId, { title, body, data } = {}) {
  if (!userId) return;
  const devices = await prisma.deviceToken.findMany({
    where: { userId, isActive: true },
    select: { token: true }
  });
  if (!devices.length) return;
  return sendPushNotifications(
    devices.map((d) => ({ to: d.token, title, body, data, sound: 'default' }))
  );
}
