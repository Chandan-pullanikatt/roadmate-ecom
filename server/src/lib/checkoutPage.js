// The one web page this platform serves to a customer (2026-08-12).
//
// Everything else the customer sees is a React Native screen. This is a page
// because Razorpay's checkout is a browser widget and the alternatives are both
// native dependencies — `react-native-razorpay`, or a WebView to host the same
// widget — and a new native module crashes every installed dev client across
// three codebases. Same call as the Rider app's hand-off to Google Maps, and as
// `Gradient.js` replacing `expo-linear-gradient`: the phone already has a
// browser, and it is better at this than anything worth adding to six builds.
//
// ⚠️ **This page cannot mark anything paid, and must never be able to.**
// Razorpay's `handler` fires in the customer's own browser, which is to say on
// a device the customer controls, so it is used for exactly one thing: sending
// them back to the app. The order flips to PAID when the signed webhook arrives
// server-to-server (`paymentController.razorpayWebhook`) and the tracking screen
// is already polling for precisely that. This is the rule Phase 1.8 wrote down —
// the client's own callback is never trusted — expressed as a page.
import { colors } from './brand.js';

/** HTML-escape. Product names and customer names are user-controlled text. */
const esc = (raw) =>
  String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * Values crossing into a <script> block. `JSON.stringify` handles quoting and
 * control characters; the `<` escape is what stops a name containing `</script>`
 * from closing the block early, which is an XSS the JSON encoding alone does
 * not prevent.
 */
const js = (value) => JSON.stringify(value ?? null).replaceAll('<', '\\u003c');

const shell = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · RoadMate</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: ${colors.pageBg};
    color: ${colors.ink};
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%; max-width: 420px;
    background: ${colors.surface};
    border-radius: 14px;
    padding: 28px 24px;
    box-shadow: 0 6px 24px rgba(11,18,32,0.08);
    text-align: center;
  }
  .mark {
    display: inline-block; margin-bottom: 18px;
    font-weight: 800; letter-spacing: .14em; font-size: 13px;
    text-transform: uppercase; color: ${colors.inkMuted};
  }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 700; }
  .amount { margin: 14px 0 2px; font-size: 38px; font-weight: 800; letter-spacing: -.02em; }
  .meta { margin: 0; color: ${colors.inkMuted}; font-size: 14px; }
  .btn {
    display: block; width: 100%; margin-top: 22px;
    padding: 15px 18px; border: 0; border-radius: 10px;
    background: ${colors.accent}; color: ${colors.onAccent};
    font: inherit; font-weight: 700; cursor: pointer;
  }
  .btn.secondary { background: transparent; color: ${colors.inkMuted}; font-weight: 600; margin-top: 10px; }
  .note { margin-top: 18px; font-size: 13px; color: ${colors.inkMuted}; }
  .bad { color: ${colors.danger}; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

/**
 * A dead end that explains itself. Every failure this page can hit — an expired
 * ticket, an order that is already paid, a gateway nobody has configured — ends
 * here rather than on a blank screen or a spinner, because the customer is
 * holding a phone with money on the line and "nothing happened" is the worst
 * thing this page could do.
 */
export function renderMessagePage({ title, message, deepLink, tone = 'neutral' }) {
  return shell(
    title,
    `
    <div class="mark">RoadMate</div>
    <h1 class="${tone === 'bad' ? 'bad' : ''}">${esc(title)}</h1>
    <p class="meta">${esc(message)}</p>
    ${deepLink ? `<a class="btn" href="${esc(deepLink)}">Back to the app</a>` : ''}
  `
  );
}

/**
 * The checkout itself.
 *
 * `order_id` is a gateway order the server created and stored on the `Payment`
 * row, so the amount is fixed server-side and nothing on this page can change
 * what is charged — the fields below are display only.
 */
export function renderCheckoutPage({ keyId, razorpayOrderId, amount, orderNumber, customer, deepLink }) {
  const body = `
    <div class="mark">RoadMate</div>
    <h1>Order ${esc(orderNumber)}</h1>
    <div class="amount">₹${esc(amount)}</div>
    <p class="meta">Pay by UPI, card or netbanking.</p>
    <button class="btn" id="pay">Pay ₹${esc(amount)}</button>
    <a class="btn secondary" href="${esc(deepLink)}">Cancel and go back</a>
    <p class="note" id="note">You will come back to the app once the payment is confirmed.</p>

    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      var DEEP_LINK = ${js(deepLink)};
      var note = document.getElementById('note');

      var options = {
        key: ${js(keyId)},
        order_id: ${js(razorpayOrderId)},
        amount: ${js(Math.round(Number(amount) * 100))},
        currency: 'INR',
        name: 'RoadMate',
        description: ${js('Order ' + orderNumber)},
        prefill: {
          name: ${js(customer.name || '')},
          contact: ${js(customer.phone || '')},
          email: ${js(customer.email || '')}
        },
        theme: { color: ${js(colors.accent)} },
        // Success in the customer's own browser is not proof of payment — the
        // webhook is. So this does one thing: send them back to a screen that is
        // already polling for the real answer.
        handler: function () {
          note.textContent = 'Payment received. Taking you back to the app…';
          window.location.href = DEEP_LINK;
        },
        modal: {
          // A dismissed modal is not a failure, and must not read as one: the
          // order still exists, still unpaid, and the button below re-opens the
          // same gateway order rather than creating a second one.
          ondismiss: function () {
            note.textContent = 'Payment cancelled. Your order is still waiting — you can pay again.';
          }
        }
      };

      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function (response) {
        note.textContent = (response && response.error && response.error.description)
          ? response.error.description
          : 'That payment did not go through. Please try again.';
      });

      document.getElementById('pay').onclick = function () { rzp.open(); };
      // Open immediately: the customer tapped "Pay online" in the app one screen
      // ago, so making them tap a second button to reach the same place is a
      // step that exists only because of how this is built.
      rzp.open();
    </script>
  `;
  return shell(`Pay ₹${amount}`, body);
}
