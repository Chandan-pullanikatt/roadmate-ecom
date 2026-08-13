// Opening the payment page (2026-08-12).
//
// The app does not run Razorpay's checkout; it hands off to the phone's browser
// and comes back. `Linking` is React Native core, so this adds **no dependency**
// — which is the whole reason the hand-off exists rather than a WebView or
// `react-native-razorpay`, either of which is a native module and would crash
// every installed dev client across three codebases (HANDOFF §6).
//
// The same shape as the Rider app's navigation: a URL, the system app, and no
// second implementation of something the phone already does better.
import { Alert, Linking } from 'react-native';

/**
 * Ask the server for a fresh payment link and open it.
 *
 * Fresh every time, deliberately: the ticket in the URL lives fifteen minutes,
 * so caching one would hand the customer an expired link exactly when they came
 * back to pay after being interrupted.
 *
 * Never throws. Two screens call this and neither has anything useful to do with
 * an exception — the order exists either way, and the order screen keeps
 * offering Pay. What it must not do is fail *silently*, so every failure is an
 * alert that says what happened to the order.
 *
 * @returns {Promise<boolean>} whether the browser was actually opened
 */
export async function openPayment(api, orderId) {
  let payment;
  try {
    payment = await api.createRazorpayOrder(orderId);
  } catch (err) {
    Alert.alert(
      'Could not start the payment',
      `${err.message}\n\nYour order is placed and waiting. You can pay from the order screen.`
    );
    return false;
  }

  // The server says whether the gateway is actually configured. Without
  // credentials it returns a stub id no gateway knows, and opening a checkout
  // against one is a page that can only fail in the customer's hands.
  if (payment?.gatewayReady === false || !payment?.paymentUrl) {
    Alert.alert(
      'Online payment is not available',
      'Nothing has been charged and your order is still waiting. Please contact support, or place cash-on-delivery orders meanwhile.'
    );
    return false;
  }

  try {
    await Linking.openURL(payment.paymentUrl);
    return true;
  } catch {
    // A phone with no browser able to take an https URL is close to impossible,
    // but "nothing happened when I tapped Pay" is the one outcome worth ruling
    // out explicitly.
    Alert.alert('No browser available', 'This phone could not open the payment page.');
    return false;
  }
}
