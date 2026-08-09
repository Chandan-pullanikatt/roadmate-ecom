// Carts — plural, one per shop.
//
// `GET /api/customer/cart` returns every cart the customer has open, because a
// cart never spans shops: adding from a second shop opens a second cart rather
// than moving the first (server §1.3). That is the honest model — a basket
// across two shops is two deliveries, two accept windows and two riders — and
// this screen's whole job is to make it visible instead of surprising.
//
// **Nothing here is reserved.** A cart holds no stock; reservation happens once,
// atomically, at placement. So a line can be priced and available now and gone
// at checkout, and the server says so per line (`isAvailable`, `availableQty`)
// rather than letting the customer find out at the last tap. Reserving at
// add-to-cart would let an abandoned cart starve a shop's shelf.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  typography,
  Card,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  QuantityStepper,
  connectionMessage,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../../src/session.js';

export default function CartTab() {
  const api = useApi();
  const router = useRouter();
  const [busyItemId, setBusyItemId] = useState(null);

  const carts = useResource(useCallback(() => api.listCarts(), [api]));
  const list = (carts.data?.carts ?? []).filter((c) => c.items.length > 0);
  const problem = connectionMessage(carts.error);

  const setQuantity = async (item, quantity) => {
    setBusyItemId(item.id);
    try {
      await carts.withPause(() => api.updateCartItem(item.id, quantity));
    } catch (err) {
      Alert.alert(
        'Could not change that',
        err.status === 409 && err.body?.availableQty != null
          ? err.body.availableQty > 0
            ? `The shop only has ${err.body.availableQty} of these left.`
            : 'That item just went out of stock at this shop.'
          : err.message
      );
    } finally {
      setBusyItemId(null);
    }
  };

  const discard = (cart) =>
    Alert.alert('Empty this cart?', `Everything from ${cart.shop?.name ?? 'this shop'} will be removed.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Empty',
        style: 'destructive',
        onPress: () => carts.withPause(() => api.clearCart(cart.id)).catch(() => {})
      }
    ]);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={carts.refreshing} onRefresh={() => carts.reload()} tintColor={colors.accent} />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => carts.reload()} /> : null}

      {carts.loading && !carts.data ? (
        <SkeletonCard count={3} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing in your cart"
            message="Pick a shop from the home screen, or search for something specific."
            action={<Button label="Find a shop" onPress={() => router.push('/(tabs)')} />}
          />
        </Card>
      ) : (
        list.map((cart) => (
          <View key={cart.id}>
            <SectionHeader title={cart.shop?.name ?? 'Shop'} action="Empty" onAction={() => discard(cart)} />

            {cart.hasUnavailableItems ? (
              <Banner
                tone="warning"
                message="Something in this cart is no longer available at this shop. Remove it, or the order will be refused."
              />
            ) : null}

            <Card style={styles.card}>
              {cart.items.map((item, index) => (
                <View key={item.id} style={[styles.line, index > 0 && styles.ruled]}>
                  <View style={styles.lineBody}>
                    <Text style={typography.cardTitle} numberOfLines={2}>
                      {item.variantLabel ? `${item.productName} · ${item.variantLabel}` : item.productName}
                    </Text>
                    {item.addOns.length ? (
                      <Text style={typography.meta}>{item.addOns.map((a) => a.label).join(', ')}</Text>
                    ) : null}
                    <Text style={typography.meta}>
                      {formatINR(item.unitPrice)} each
                      {item.isAvailable ? '' : ' · unavailable'}
                    </Text>
                  </View>

                  <View style={styles.lineRight}>
                    <Text style={typography.money}>{formatINR(item.lineTotal)}</Text>
                    <QuantityStepper
                      value={item.quantity}
                      // 0 removes the line — the endpoint's own contract, so
                      // there is no separate delete button to keep in step.
                      onChange={(next) => setQuantity(item, next)}
                      min={0}
                      max={Math.max(item.availableQty, item.quantity)}
                      disabled={busyItemId === item.id}
                    />
                  </View>
                </View>
              ))}

              <View style={styles.subtotal}>
                <Text style={typography.body}>Subtotal</Text>
                <Text style={typography.money}>{formatINR(cart.subtotal)}</Text>
              </View>

              {/* Tax, the delivery fee and any coupon land at checkout, because
                  all three depend on the address and the industry rather than on
                  the basket. Showing a "total" here that the bill then changed
                  would be the wrong kind of certainty. */}
              <Text style={typography.meta}>Delivery, taxes and offers are applied at checkout.</Text>

              <Button
                label="Checkout"
                onPress={() => router.push(`/checkout?cartId=${cart.id}`)}
                disabled={cart.hasUnavailableItems}
              />
            </Card>
          </View>
        ))
      )}

      {list.length > 1 ? (
        <Text style={styles.footnote}>
          These are separate orders. Each one goes to its own shop and arrives on its own.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  card: { gap: spacing.md },
  line: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  ruled: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  lineBody: { flex: 1, gap: 2 },
  lineRight: { alignItems: 'flex-end', gap: spacing.sm },
  subtotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md
  },
  footnote: { ...typography.meta, textAlign: 'center' }
});
