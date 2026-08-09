// SMS delivery, via MSG91. The same shape as `razorpay.js`: real when the
// environment carries credentials, a logging stub when it does not, and **no
// caller changes either way**.
//
// The client has an MSG91 subscription and is handing over credentials. This is
// the last thing between the platform and a real customer login (PLAN §6): the
// whole OTP flow — hashing, TTL, attempt counting, rate limiting, single
// consumption — has been real since §1.1; only the delivery leg was a
// `console.log`.
//
// Three things this file is careful about:
//
//   • **The OTP must never leak in production.** That rule lives in the
//     controller (`exposesCode()`), not here, and a test pins it. This file
//     never returns the code to anyone.
//   • **A failed send must be visible.** The stub returning `{ sent: false }`
//     and a genuine MSG91 outage returning `{ sent: false }` are different
//     facts, so they carry different `reason`s. A customer who never gets a
//     code and a platform that cannot tell why is the worst version of this.
//   • **It never throws into the request path.** `requestOtp` has already
//     written the hashed token by the time this is called; an exception here
//     would 500 a request whose side effect already happened, and the customer
//     would be locked out of re-requesting by the rate limiter for a failure
//     that was ours.
//
// Setup, when the credentials land:
//
//   MSG91_AUTH_KEY     — from MSG91 dashboard → Authentication Key
//   MSG91_TEMPLATE_ID  — the approved DLT template for the OTP message
//   MSG91_SENDER_ID    — the 6-character DLT header, optional if the template
//                        already carries one
//
// The template must have exactly one variable for the code; MSG91's OTP
// endpoint substitutes it as `##OTP##` / the `otp` param. Nothing else changes.

const authKey = () => process.env.MSG91_AUTH_KEY;
const templateId = () => process.env.MSG91_TEMPLATE_ID;
const senderId = () => process.env.MSG91_SENDER_ID;

/** True once the client's credentials are in the environment. */
export const isLive = () => Boolean(authKey() && templateId());

// Tests must never make a network call, and must never depend on one.
const isTest = () => process.env.NODE_ENV === 'test';

const MSG91_OTP_URL = 'https://control.msg91.com/api/v5/otp';

/**
 * Send an OTP to an Indian mobile number.
 *
 * @param {string} phone 10-digit normalised number (`lib/phone.js`)
 * @param {string} code  the plaintext OTP — logged only outside production
 * @returns {Promise<{sent: boolean, provider: string, reason?: string}>}
 *   Never rejects. The caller records the outcome; it does not retry.
 */
export async function sendOtpSms(phone, code) {
  if (!isLive() || isTest()) {
    // Outside production the code is echoed in the API response anyway (a test
    // pins that production does not), so this log is for local development.
    if (process.env.NODE_ENV !== 'production' && !isTest()) {
      console.log(`[otp] ${phone} -> ${code}`);
    }
    return { sent: false, provider: 'stub', reason: isTest() ? 'TEST' : 'NO_CREDENTIALS' };
  }

  try {
    const body = {
      template_id: templateId(),
      // MSG91 wants the country code on the wire; `phone` is stored without it.
      mobile: `91${phone}`,
      otp: code,
      ...(senderId() ? { sender: senderId() } : {})
    };

    const res = await fetch(MSG91_OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: authKey() },
      body: JSON.stringify(body),
      // A customer is staring at a spinner. Ten seconds is already generous;
      // past that, failing is better than holding the request open.
      signal: AbortSignal.timeout(10_000)
    });

    const payload = await res.json().catch(() => ({}));

    // MSG91 answers 200 with `{ type: 'error' }` for template and balance
    // problems, so the HTTP status alone is not the outcome.
    if (!res.ok || payload?.type === 'error') {
      const reason = payload?.message || `HTTP ${res.status}`;
      console.error(`[sms] MSG91 refused OTP to ${phone}: ${reason}`);
      return { sent: false, provider: 'msg91', reason: String(reason) };
    }

    return { sent: true, provider: 'msg91' };
  } catch (error) {
    // Includes the timeout above. Deliberately swallowed — see the header note.
    console.error(`[sms] MSG91 send failed for ${phone}:`, error.message);
    return { sent: false, provider: 'msg91', reason: error.message };
  }
}
