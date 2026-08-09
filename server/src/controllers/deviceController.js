// Phase 2 — push registration. One handler, mounted twice: once behind
// `protect` (staff — the shop app today) and once behind `protectCustomer`
// (Phase 4). `DeviceToken_owner_xor` in the schema enforces a device belongs
// to exactly one of them; this handler never sets both.
import prisma from '../lib/prisma.js';

const VALID_PLATFORMS = new Set(['ios', 'android']);

/** POST /api/devices or /api/customer/devices — upsert on the unique token. */
export const registerDevice = async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = req.body?.platform;

    if (!token) return res.status(400).json({ message: 'A push token is required.' });
    if (!VALID_PLATFORMS.has(platform)) {
      return res.status(400).json({ message: 'platform must be "ios" or "android".' });
    }

    const userId = req.user?.id ?? null;
    const customerId = req.customer?.id ?? null;
    if (!userId && !customerId) {
      return res.status(401).json({ message: 'Not authorized.' });
    }

    const now = new Date();
    const device = await prisma.deviceToken.upsert({
      where: { token },
      // Re-registering on a different account (a shared shop phone, a
      // reinstall under a new login) must move the row, not collide with it.
      create: { token, platform, userId, customerId, isActive: true, lastSeenAt: now },
      update: { platform, userId, customerId, isActive: true, lastSeenAt: now }
    });

    return res.status(200).json({
      status: 'success',
      device: { id: device.id, token: device.token, platform: device.platform }
    });
  } catch (error) {
    console.error('Register Device Error:', error);
    return res.status(500).json({ message: 'Server error while registering this device.' });
  }
};
