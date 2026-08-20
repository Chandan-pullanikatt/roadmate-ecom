// Checkout — one cart, one address, one payment method, one tap.
//
// **The bill is not computed here, and that is deliberate.** Tax is a
// per-industry `PlatformConfig` row, the delivery fee is another, and a coupon
// is resolved server-side against usage limits this app cannot see. Every one
// of those is a number the server owns, frozen onto the order at placement and
// read back by settlement. A client-side "estimated total" would be a second
// answer to a question that already has one, and the two would disagree the
// first time the client changed a rate from the Master settings screen. So this
// screen shows the cart's subtotal, says plainly that the rest is added when the
// order is placed, and the order screen shows the real bill a second later.
//
// **What can go wrong here is not technical, and every case has its own
// sentence:** a line that sold out while the cart sat there (409, with the
// product named), no delivery partner on shift (422 `NO_RIDER`), a shop that
// does not reach this address (422 `NOT_SERVICEABLE`), a membership that must
// be paid online (422 `PREPAID_REQUIRED`). None of them is a retry.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  GroupedCard,
  GroupedRow,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  StickyFooter,
  KeyValue,
  connectionMessage,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../src/session.js';
import { usePlace } from '../src/place.js';
import { PREPAID_ENABLED } from '../src/config.js';
import { openPayment } from '../src/payment.js';
import {
  formatAddress,
  isVoucherIndustry,
  isBookingIndustry,
  needsPrescription,
  voucherNoun
} from '../src/order.js';

export default function Checkout() {
  const { cartId } = useLocalSearchParams();
  const api = useApi();
  const router = useRouter();
  const { addresses, address, setAddressId, fulfilmentType } = usePlace();

  const [couponCode, setCouponCode] = useState('');
  const [instructions, setInstructions] = useState('');
  // NO_DELIVERY is PREPAID-only on the server, so the default is decided by the
  // industry rather than by a preference.
  const voucherOnly = isVoucherIndustry(fulfilmentType);
  const booking = isBookingIndustry(fulfilmentType);
  const [paymentMethod, setPaymentMethod] = useState(voucherOnly ? 'PREPAID' : 'COD');
  const [slotId, setSlotId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const carts = useResource(useCallback(() => api.listCarts(), [api]), { cacheKey: 'carts' });
  const cart = useMemo(
    () => (carts.data?.carts ?? []).find((c) => String(c.id) === String(cartId)) ?? null,
    [carts.data, cartId]
  );

  // The offers this customer could use (PHASE A.3). Before this list existed the
  // field below was the whole feature: a coupon worked only for somebody who had
  // already been told its code, so every offer the platform ran was invisible to
  // everybody else.
  //
  // Scoped to this cart's shop, so one shop's offer is never advertised on
  // another's. Failure is silent on purpose — offers are an extra, and an
  // unreachable offers list must not stop somebody buying something.
  const offers = useResource(
    useCallback(
      () => api.listCoupons({ shopId: cart?.shop?.id, industryId: cart?.industryId }),
      [api, cart?.shop?.id, cart?.industryId]
    )
  );
  const offerList = offers.data?.coupons ?? [];

  // The hours this venue is selling. Only fetched for a booking industry —
  // every other checkout would be asking for a calendar that does not exist.
  //
  // Full and closed hours come back flagged rather than missing, so the picker
  // greys them: a gap in a calendar reads as a bug, a greyed "Booked" reads as a
  // busy venue.
  const slots = useResource(
    useCallback(
      () => (booking && cart?.shop?.id ? api.getShopSlots(cart.shop.id) : Promise.resolve({ slots: [] })),
      [api, booking, cart?.shop?.id]
    ),
    { deps: [booking, cart?.shop?.id] }
  );
  const slotList = slots.data?.slots ?? [];
  const chosenSlot = slotList.find((s) => s.id === slotId) ?? null;

  const problem = connectionMessage(carts.error);
  const needsAddress = !voucherOnly;
  const canPrepay = PREPAID_ENABLED;
  const blocked =
    (needsAddress && !address) ||
    (booking && !chosenSlot) ||
    (paymentMethod === 'PREPAID' && !canPrepay) ||
    (voucherOnly && !canPrepay);

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.placeOrder({
        cartId: cart.id,
        addressId: needsAddress ? address.id : undefined,
        slotId: booking ? slotId : undefined,
        paymentMethod,
        couponCode: couponCode.trim() || undefined,
        instructions: instructions.trim() || undefined
      });

      const order = result.order;

      // A prepaid order is not routed until the Razorpay webhook lands, so the
      // gateway order is created immediately rather than on the tracking screen
      // — the customer is still holding the phone right now.
      //
      // ⚠️ **Navigate first, then open the browser** (2026-08-12). The order
      // screen is what polls for the webhook, so it has to be the screen behind
      // the browser — a customer who pays and hits Back must land on their order,
      // not on a checkout for a cart that no longer exists. `openPayment`
      // swallows its own failures for the same reason: the order is placed and
      // real whatever the browser does, and the order screen offers Pay again.
      router.replace(`/order/${order.id}`);

      if (paymentMethod === 'PREPAID') {
        await openPayment(api, order.id);
      }
    } catch (err) {
      setError(readPlacementError(err));
      // The calendar is what went stale, so refresh it and drop the pick rather
      // than leaving a chosen time the server has just refused.
      if (String(err.reason ?? '').startsWith('SLOT_')) {
        setSlotId(null);
        slots.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        {problem ? <Banner message={problem} action="Retry" onAction={() => carts.reload()} /> : null}

        {carts.loading && !carts.data ? (
          <SkeletonCard count={3} />
        ) : !cart ? (
          <Card>
            <EmptyState
              title="This cart is gone"
              message="It was either checked out already or emptied. Your other carts are on the Cart tab."
              action={<Button label="Back to cart" onPress={() => router.replace('/(tabs)/cart')} />}
            />
          </Card>
        ) : (
          <>
            <SectionHeader title={cart.shop?.name ?? 'Your order'} />

            <Card style={styles.card}>
              {cart.items.map((item) => (
                <KeyValue
                  key={item.id}
                  label={`${item.quantity} × ${
                    item.variantLabel ? `${item.productName} · ${item.variantLabel}` : item.productName
                  }`}
                  value={formatINR(item.lineTotal)}
                />
              ))}
              <View style={styles.rule} />
              <KeyValue label="Subtotal" value={formatINR(cart.subtotal)} strong />
              <Text style={typography.meta}>
                Taxes{needsAddress ? ', the delivery fee' : ''} and any offer are added when the order is
                placed. You will see the full bill on the next screen, before anything is collected.
              </Text>
            </Card>

            {needsAddress ? (
              <View>
                <SectionHeader title="Deliver to" action="Manage" onAction={() => router.push('/addresses')} />
                {addresses.length === 0 ? (
                  <Card>
                    <EmptyState
                      title="No address saved"
                      message="An order needs a place to go — with coordinates, not just a street name, because that is what routes it."
                      action={<Button label="Add an address" onPress={() => router.push('/addresses')} />}
                    />
                  </Card>
                ) : (
                  <GroupedCard>
                    {addresses.map((a) => (
                      <GroupedRow
                        key={a.id}
                        label={a.label}
                        sublabel={formatAddress(a)}
                        right={
                          a.id === address?.id ? <Text style={styles.tick}>✓</Text> : null
                        }
                        onPress={() => setAddressId(a.id)}
                      />
                    ))}
                  </GroupedCard>
                )}
              </View>
            ) : booking ? (
              <SlotPicker
                slots={slotList}
                loading={slots.loading && !slots.data}
                chosen={chosenSlot}
                onChoose={setSlotId}
                onRetry={() => slots.reload()}
                error={connectionMessage(slots.error)}
              />
            ) : (
              <Banner
                tone="info"
                message="A membership is not delivered. You get a code straight after payment and show it at the counter."
              />
            )}

            {needsPrescription(fulfilmentType) ? (
              <Banner
                tone="warning"
                // The upload lives on the order screen, not here, because the
                // endpoint attaches a prescription to an *order* and there is no
                // order until this button is pressed. Saying so now means the
                // next screen's camera prompt is expected rather than a surprise.
                message="Pharmacy orders are checked by a pharmacist first. You will be asked for a photo of your prescription on the next screen, and no shop is asked to pack the order until it is approved."
              />
            ) : null}

            <View>
              <SectionHeader title="Payment" />
              <GroupedCard>
                <GroupedRow
                  label="Cash on delivery"
                  sublabel={
                    booking
                      ? 'Not available for bookings — the venue is paid through RoadMate, not at its own gate.'
                      : voucherOnly
                        ? 'Not available for memberships — the gym is paid through RoadMate, not at its own counter.'
                        : 'Pay your delivery partner at the door.'
                  }
                  right={paymentMethod === 'COD' ? <Text style={styles.tick}>✓</Text> : null}
                  onPress={voucherOnly ? undefined : () => setPaymentMethod('COD')}
                />
                <GroupedRow
                  label="Pay online"
                  sublabel={
                    canPrepay
                      ? 'UPI, cards and netbanking through Razorpay.'
                      : // ⚠️ This used to read "the payment gateway account is
                        // still being set up", which stopped being true the day
                        // the client's Razorpay keys landed (2026-08-08) and is
                        // now a false statement about their business shown to
                        // every customer. The app cannot actually tell why
                        // prepaid is off — all it knows is that **this bundle**
                        // was built without `EXPO_PUBLIC_RAZORPAY_KEY_ID`, which
                        // on an EAS build means the key was never passed to the
                        // builder (`.env` is gitignored, so EAS never sees it —
                        // see `.env.example`). So it no longer guesses at a
                        // cause: it states the consequence, which is the only
                        // part it can vouch for.
                        'Not available right now. You can still pay cash at the door.'
                  }
                  right={paymentMethod === 'PREPAID' ? <Text style={styles.tick}>✓</Text> : null}
                  onPress={canPrepay ? () => setPaymentMethod('PREPAID') : undefined}
                />
              </GroupedCard>
            </View>

            {/* Offers, tappable (PHASE A.3). The code field below still exists —
                a customer given a code out of band should be able to type it —
                but nobody has to know one any more.

                ⚠️ Tapping fills the field; it does not claim the offer applies.
                `resolveCoupon` runs at placement against the real cart, and a
                minimum this cart has not reached comes back as its own message.
                The threshold is shown here so that is not a surprise. */}
            {offerList.length > 0 ? (
              <View style={styles.field}>
                <Text style={typography.meta}>Offers for you</Text>
                <GroupedCard>
                  {offerList.map((offer) => (
                    <GroupedRow
                      key={offer.code}
                      label={offer.title}
                      sublabel={
                        offer.subtitle ||
                        (Number(offer.minOrderValue) > 0
                          ? `On orders above ${formatINR(offer.minOrderValue)}`
                          : offer.code)
                      }
                      right={
                        <Text
                          style={[
                            styles.offerCode,
                            couponCode === offer.code || offer.autoApply
                              ? styles.offerCodePicked
                              : null
                          ]}
                        >
                          {offer.autoApply
                            ? 'Automatic'
                            : couponCode === offer.code
                              ? '✓ Applied'
                              : offer.code}
                        </Text>
                      }
                      // An automatic offer needs no tap and no code — the server
                      // applies the best qualifying one at placement. Typing its
                      // code would work, but it would also stop a better
                      // automatic offer from being chosen.
                      onPress={
                        offer.autoApply
                          ? undefined
                          : () => setCouponCode(couponCode === offer.code ? '' : offer.code)
                      }
                    />
                  ))}
                </GroupedCard>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={typography.meta}>Offer code</Text>
              <TextInput
                style={styles.input}
                value={couponCode}
                onChangeText={setCouponCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="Optional"
                placeholderTextColor={colors.inkFaint}
              />
            </View>

            <View style={styles.field}>
              <Text style={typography.meta}>
                {voucherOnly ? 'Anything the shop should know' : 'Delivery instructions'}
              </Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={instructions}
                onChangeText={setInstructions}
                multiline
                maxLength={500}
                placeholder={voucherOnly ? 'Optional' : 'Gate code, landmark, “leave with the guard”…'}
                placeholderTextColor={colors.inkFaint}
              />
            </View>

            {error ? <Banner tone="danger" message={error} /> : null}
          </>
        )}
      </ScrollView>

      {cart ? (
        <StickyFooter>
          {voucherOnly && !canPrepay ? (
            <Text style={styles.blockedNote}>
              {booking ? 'Bookings are' : 'Memberships are'} paid online and online payment is not
              available yet.
            </Text>
          ) : booking && !chosenSlot ? (
            <Text style={styles.blockedNote}>Pick a time above to book it.</Text>
          ) : null}
          <Button
            label={paymentMethod === 'COD' ? `Place order · ${formatINR(cart.subtotal)}+` : 'Pay and place order'}
            onPress={place}
            loading={busy}
            disabled={blocked || cart.hasUnavailableItems}
          />
        </StickyFooter>
      ) : null}
    </View>
  );
}

/**
 * The calendar (SERVICE_BOOKING) — what a turf sells instead of a delivery slot.
 *
 * Grouped by day, because a flat list of forty hours is unreadable and nobody
 * books "the 31st hour from now" — they book Saturday evening.
 *
 * **A full hour is shown, greyed, not hidden.** A calendar with 6pm and 8pm and
 * no 7pm reads as a bug in the app; a 7pm marked "Booked" reads as a busy venue,
 * which is both true and better for the venue. Nothing can be bought through one
 * — placement re-checks and answers `SLOT_FULL`.
 */
function SlotPicker({ slots, loading, chosen, onChoose, onRetry, error }) {
  const days = useMemo(() => {
    const map = new Map();
    for (const slot of slots) {
      const key = new Date(slot.startsAt).toLocaleDateString([], {
        weekday: 'long',
        day: 'numeric',
        month: 'short'
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(slot);
    }
    return [...map.entries()];
  }, [slots]);

  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View>
      <SectionHeader title="Pick your time" />

      {error ? <Banner message={error} action="Retry" onAction={onRetry} /> : null}

      {loading ? (
        <SkeletonCard count={2} />
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            title="No times open"
            message="This venue has not opened any hours yet. Try again later, or pick another venue."
          />
        </Card>
      ) : (
        days.map(([day, daySlots]) => (
          <View key={day} style={styles.field}>
            <Text style={typography.meta}>{day}</Text>
            <GroupedCard>
              {daySlots.map((slot) => (
                <GroupedRow
                  key={slot.id}
                  label={`${time(slot.startsAt)} – ${time(slot.endsAt)}`}
                  sublabel={
                    !slot.isBookable
                      ? 'Booked'
                      : slot.placesLeft <= 2
                        ? `Only ${slot.placesLeft} left`
                        : slot.productName
                  }
                  value={slot.priceOverride ? formatINR(slot.priceOverride) : undefined}
                  right={slot.id === chosen?.id ? <Text style={styles.tick}>✓</Text> : null}
                  tone={!slot.isBookable ? 'muted' : undefined}
                  onPress={slot.isBookable ? () => onChoose(slot.id) : undefined}
                />
              ))}
            </GroupedCard>
          </View>
        ))
      )}

      <Text style={typography.meta}>
        You get a code straight after payment. It opens the gate for this hour only — not before it,
        not after.
      </Text>
    </View>
  );
}

/**
 * Every failure this call has is a sentence about the world, not about the
 * network. Turning them into one "something went wrong" would throw away the
 * only thing the customer can act on.
 */
function readPlacementError(err) {
  if (err.status === 409) {
    return err.message || 'Something in your cart just sold out. Please update it and try again.';
  }
  switch (err.reason) {
    case 'NO_RIDER':
      return 'No delivery partner is on shift near you right now. This usually clears within the hour.';
    case 'NOT_SERVICEABLE':
      return 'This shop does not deliver to the address you picked. Choose another address or another shop.';
    case 'PREPAID_REQUIRED':
      return 'A membership has to be paid online.';
    case 'UNSUPPORTED_FULFILMENT_TYPE':
      return 'This category cannot take orders yet.';
    // The calendar moved under the customer between rendering and tapping.
    // `SLOT_FULL` is the one that will actually happen — everybody wants the
    // same evening hour — and none of these is a retry.
    case 'SLOT_FULL':
      return 'Somebody just booked that time. Pick another one — the calendar above has been refreshed.';
    case 'SLOT_PASSED':
      return 'That time has already started. Pick a later one.';
    case 'SLOT_CLOSED':
      return 'The venue has closed that time. Pick another one.';
    case 'SLOT_REQUIRED':
      return 'Pick a time before booking.';
    default:
      return err.message;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  card: { gap: spacing.xs },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  tick: { fontSize: 16, fontWeight: '800', color: colors.success },
  offerCode: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.inkMuted
  },
  offerCodePicked: { color: colors.success },
  field: { gap: spacing.xs },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    fontSize: 15,
    color: colors.ink
  },
  multiline: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  blockedNote: { ...typography.meta, textAlign: 'center', color: colors.danger }
});
