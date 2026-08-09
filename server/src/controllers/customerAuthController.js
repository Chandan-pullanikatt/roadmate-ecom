// Phase 1.1 — customer phone + OTP login.
//
// SMS delivery goes through `src/lib/sms.js` (MSG91), which is real once the
// client's credentials are in the environment and a logging stub until then —
// the same seam `razorpay.js` uses, and no caller here changes either way.
// Outside production the code is echoed in the response so the flow is fully
// testable without a provider. Everything else has always been real: the code is
// bcrypt-hashed, expires, counts attempts, and is consumed once.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../lib/prisma.js';
import { signCustomerToken } from '../lib/customerToken.js';
// Moved to `src/lib/phone.js` when staff sign-in started accepting phone
// numbers too — one normaliser for both sides, so one human is one row on
// either. Behaviour here is unchanged.
import { normalizePhone } from '../lib/phone.js';
// The delivery leg. Real once MSG91_AUTH_KEY / MSG91_TEMPLATE_ID are set, a
// logging stub until then, and never throws — see `src/lib/sms.js`.
import { sendOtpSms, isLive as smsIsLive } from '../lib/sms.js';

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 300); // 5 minutes
const OTP_MAX_ATTEMPTS = 5; // wrong guesses before the token is burned
const OTP_REQUEST_WINDOW_SECONDS = 600;
const OTP_MAX_REQUESTS_PER_WINDOW = 5; // per phone, per window

const generateCode = () => {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
};

// Only test/development ever see the code. Production must not leak it.
const exposesCode = () => process.env.NODE_ENV !== 'production';

const publicCustomer = (c) => ({ id: c.id, phone: c.phone, name: c.name, email: c.email });

export const requestOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ message: 'Please provide a valid 10-digit mobile number.' });
    }

    const windowStart = new Date(Date.now() - OTP_REQUEST_WINDOW_SECONDS * 1000);
    const recent = await prisma.otpToken.count({
      where: { phone, createdAt: { gte: windowStart } }
    });
    if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ message: 'Too many OTP requests. Please try again shortly.' });
    }

    const code = generateCode();

    // Supersede any live code for this phone, so only the newest one verifies.
    await prisma.otpToken.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date() }
    });

    await prisma.otpToken.create({
      data: {
        phone,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000)
      }
    });

    const delivery = await sendOtpSms(phone, code);

    // In production, a code the customer will never receive is a dead end: the
    // rate limiter would then hold them off for ten minutes over our outage.
    // Say so plainly rather than claiming "OTP sent".
    if (!delivery.sent && smsIsLive() && !exposesCode()) {
      return res.status(502).json({
        message: 'Could not send the OTP right now. Please try again in a moment.',
        reason: 'SMS_DELIVERY_FAILED'
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP sent.',
      expiresInSeconds: OTP_TTL_SECONDS,
      // ⚠️ Production never sees this — a test pins it. It is what makes the
      // flow testable while SMS is stubbed.
      ...(exposesCode() ? { code } : {})
    });
  } catch (error) {
    console.error('OTP Request Error:', error);
    return res.status(500).json({ message: 'Server error while sending the OTP.' });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : null;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Please provide a valid mobile number and OTP.' });
    }

    const token = await prisma.otpToken.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }
    });

    // One message for every failure mode — a caller must not learn whether the
    // phone has a pending code, only that this attempt failed.
    const invalid = () => res.status(401).json({ message: 'Invalid or expired OTP.' });

    if (!token) return invalid();

    // Locked out. The token is left un-consumed on purpose so this branch keeps
    // answering 429 — and so the *correct* code cannot be tried afterwards
    // either. It stays dead until it expires and a new one is requested.
    if (token.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect attempts. Request a new OTP.' });
    }

    if (!(await bcrypt.compare(code, token.codeHash))) {
      await prisma.otpToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } }
      });
      return invalid();
    }

    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing?.isBlocked) {
      return res.status(403).json({ message: 'This account has been blocked.' });
    }

    await prisma.otpToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() }
    });

    const customer = existing ?? (await prisma.customer.create({ data: { phone } }));

    return res.status(200).json({
      status: 'success',
      token: signCustomerToken(customer.id),
      isNewCustomer: !existing,
      customer: publicCustomer(customer)
    });
  } catch (error) {
    console.error('OTP Verify Error:', error);
    return res.status(500).json({ message: 'Server error while verifying the OTP.' });
  }
};

export const getCustomerMe = async (req, res) => {
  return res.status(200).json({ status: 'success', customer: publicCustomer(req.customer) });
};
