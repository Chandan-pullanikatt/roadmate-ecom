// Stock management.
//
// Polished in-house against HANDOFF §5 and `designs/Partner.png` (2026-08-07).
//
// The two rules `shopInventoryController.js` enforces are the two this screen
// exists to make legible:
//
//   1. `sellable` ≠ `quantity`. The gap is the reservation plus the safety
//      buffer, and a shop owner who cannot see why "12 in stock" offers 9 will
//      assume the app is broken — so both numbers are always shown together.
//   2. An auto-hidden SKU (three consecutive stockouts, HANDOFF §3) cannot be
//      switched back on; it must be confirmed. The screen makes that the only
//      button such a row offers.
//
// What the polish changed:
//
//   • **The two numbers are now a labelled pair**, not one big figure with the
//     other buried in a meta line. Rule 1 was the reason this screen exists and
//     it was the quietest thing on it.
//   • **An auto-hidden row is visibly wrong** — red edge, red banner — instead
//     of a small red caption. A hidden SKU is earning nothing; it should look
//     like the problem it is.
//   • **The sheet's writes go through `withPause`.** They did not before. The
//     60-second stock poll is slow enough that nobody had been bitten, but the
//     rule in this app is that every mutating tap suspends its screen's poll,
//     and "slow enough to get away with" is not the rule.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet
} from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Sku,
  Button,
  Banner,
  connectionMessage,
  SearchField,
  SkeletonCard,
  EmptyState,
  QuantityStepper,
  formatINR
} from '@roadmate/ui';
import { useApi } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';

export default function Stock() {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // the row being counted, or null

  const stock = useResource(useCallback(() => api.listInventory(search || undefined), [api, search]), {
    intervalMs: POLL_MS.stock,
    deps: [search]
  });

  const items = stock.data?.items ?? [];
  const hidden = items.filter((i) => i.autoHidden).length;
  const problem = connectionMessage(stock.error);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search your shelf by name or SKU" />
        {problem ? <Banner message={problem} action="Retry" onAction={stock.reload} /> : null}
        {/* Auto-hidden SKUs are invisible to customers and the shop has no other
            way to find out. It is the one thing worth interrupting for. */}
        {hidden > 0 ? (
          <Banner
            tone="danger"
            message={`${hidden} item${hidden === 1 ? ' is' : 's are'} off sale after repeated stockouts. Recount to put ${
              hidden === 1 ? 'it' : 'them'
            } back.`}
          />
        ) : null}
      </View>

      {stock.loading && !stock.data ? (
        <View style={styles.list}>
          <SkeletonCard count={2} />
          <SkeletonCard count={2} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(row) => String(row.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={stock.refreshing} onRefresh={stock.reload} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <EmptyState
              title={search ? 'Nothing matches' : 'Your shelf is empty'}
              message={search ? 'Try a different name or SKU.' : 'Add products from your catalogue to start selling.'}
            />
          }
          renderItem={({ item }) => <StockRow item={item} onCount={() => setEditing(item)} />}
        />
      )}

      {editing ? (
        <CountSheet
          item={editing}
          api={api}
          stock={stock}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            stock.reload();
          }}
        />
      ) : null}
    </View>
  );
}

function StockRow({ item, onCount }) {
  const off = !item.isAvailable;
  return (
    <Card style={[styles.row, item.autoHidden && styles.rowHidden]}>
      <View style={styles.rowHead}>
        <View style={styles.rowInfo}>
          {item.sku ? <Sku>{item.sku}</Sku> : null}
          <Text style={typography.cardTitle} numberOfLines={2}>
            {item.name}
            {item.variantLabel ? ` · ${item.variantLabel}` : ''}
          </Text>
          <Text style={typography.money}>{formatINR(item.sellingPrice)}</Text>
        </View>

        {/* Rule 1, made visible. "On shelf" is what the shop counted; "sellable"
            is what the app is allowed to promise, and the difference is the
            reservation plus the safety buffer. Showing one without the other is
            what makes the app look broken. */}
        <View style={styles.counts}>
          <View style={styles.count}>
            <Text style={styles.countBig}>{item.quantity}</Text>
            <Text style={typography.sku}>ON SHELF</Text>
          </View>
          <View style={styles.countRule} />
          <View style={styles.count}>
            <Text style={[styles.countBig, styles.countSellable]}>{item.sellable}</Text>
            <Text style={typography.sku}>SELLABLE</Text>
          </View>
        </View>
      </View>

      {item.reserved > 0 || item.autoHidden || off ? (
        <View style={styles.tags}>
          {item.reserved > 0 ? (
            <Text style={[styles.tag, styles.tagInfo]}>{item.reserved} held for orders in flight</Text>
          ) : null}
          {item.autoHidden ? (
            <Text style={[styles.tag, styles.tagDanger]}>Off sale · {item.consecutiveStockouts} stockouts in a row</Text>
          ) : off ? (
            <Text style={[styles.tag, styles.tagMuted]}>Off sale</Text>
          ) : null}
        </View>
      ) : null}

      <Button
        label={item.autoHidden ? 'Recount to put back on sale' : 'Update count'}
        variant={item.autoHidden ? 'primary' : 'secondary'}
        onPress={onCount}
      />
    </Card>
  );
}

/** The recount/edit sheet — also the only path off an auto-hidden SKU. */
function CountSheet({ item, api, stock, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [price, setPrice] = useState(String(item.sellingPrice ?? ''));
  const [busy, setBusy] = useState(false);

  const priceValid = useMemo(() => /^\d+(\.\d{1,2})?$/.test(price.trim()), [price]);
  const priceChanged = price.trim() !== String(item.sellingPrice ?? '').trim();

  /**
   * Both writes suspend the stock poll for their duration. Without it a poll
   * landing mid-save re-renders the row from pre-save data and the shop watches
   * its own correction get undone.
   */
  const run = (action) =>
    stock.withPause(async () => {
      setBusy(true);
      try {
        await action();
        onSaved();
      } catch (error) {
        if (error.reason === 'BELOW_RESERVED') {
          Alert.alert(
            'Some units are already promised',
            `${error.body?.reserved ?? 0} unit(s) are held for orders in flight. The count can't go below that.`
          );
        } else if (error.reason === 'NEEDS_CONFIRMATION') {
          Alert.alert(
            'This item needs a recount',
            'It was taken off sale after repeated stockouts. Count the shelf and confirm — a switch is not a recount.'
          );
        } else {
          Alert.alert('Could not save', error.message);
        }
      } finally {
        setBusy(false);
      }
    });

  const save = () =>
    run(() =>
      item.autoHidden
        ? // The only endpoint that can clear the hide. A plain PATCH would be
          // refused by the API for exactly this reason.
          api.confirmInventory(item.id, quantity)
        : api.updateInventory(item.id, {
            quantity,
            ...(priceValid && priceChanged ? { sellingPrice: price.trim() } : {})
          })
    );

  const toggleAvailable = (next) => run(() => api.updateInventory(item.id, { isAvailable: next }));

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlayFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.overlayTap} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.sheetHead}>
            {item.sku ? <Sku>{item.sku}</Sku> : null}
            <Text style={typography.sectionTitle}>
              {item.name}
              {item.variantLabel ? ` · ${item.variantLabel}` : ''}
            </Text>
          </View>

          {item.autoHidden ? (
            <Banner
              tone="danger"
              message={`Taken off sale after ${item.consecutiveStockouts} stockouts in a row. Count what is actually on the shelf, then confirm.`}
            />
          ) : null}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Count on shelf</Text>
            <View style={styles.stepperRow}>
              <QuantityStepper value={quantity} onChange={setQuantity} max={100000} />
              <Text style={typography.meta}>
                {item.reserved > 0
                  ? `${item.reserved} already promised — the count can't go below that`
                  : 'What you can physically count right now'}
              </Text>
            </View>
          </View>

          {!item.autoHidden ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Selling price</Text>
              <View style={[styles.priceWrap, !priceValid && styles.priceWrapBad]}>
                <Text style={styles.priceSign}>₹</Text>
                <TextInput
                  style={styles.priceInput}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel="Selling price"
                />
              </View>
              {!priceValid ? <Text style={styles.fieldError}>Enter a price like 129.00</Text> : null}
            </View>
          ) : null}

          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={styles.sheetButton} />
            <Button
              label={item.autoHidden ? 'Confirm and put back on sale' : 'Save'}
              onPress={save}
              loading={busy}
              disabled={!item.autoHidden && !priceValid}
              style={styles.sheetButton}
            />
          </View>

          {!item.autoHidden ? (
            <Button
              label={item.isAvailable ? 'Take off sale' : 'Put on sale'}
              variant="ghost"
              onPress={() => toggleAvailable(!item.isAvailable)}
              disabled={busy}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  header: { padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: spacing.xxl },

  row: { gap: spacing.md },
  rowHidden: { borderWidth: 1, borderColor: colors.danger },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  rowInfo: { flex: 1, gap: 2 },

  counts: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  count: { alignItems: 'center', minWidth: 46 },
  countRule: { width: 1, height: 28, backgroundColor: colors.border },
  countBig: { fontSize: 22, fontWeight: '800', color: colors.ink },
  countSellable: { color: colors.success },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { fontSize: 11, fontWeight: '700', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  tagInfo: { backgroundColor: colors.infoSoft, color: colors.info },
  tagDanger: { backgroundColor: colors.dangerSoft, color: colors.danger },
  tagMuted: { backgroundColor: colors.page, color: colors.inkMuted },

  overlayFill: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  overlayTap: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.lg
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm
  },
  sheetHead: { gap: 2 },

  field: { gap: spacing.sm },
  fieldLabel: { ...typography.sku },
  fieldError: { ...typography.meta, color: colors.danger },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  priceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48
  },
  priceWrapBad: { borderColor: colors.danger },
  priceSign: { fontSize: 16, fontWeight: '700', color: colors.inkMuted },
  priceInput: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink },

  sheetActions: { flexDirection: 'row', gap: spacing.md },
  sheetButton: { flex: 1 }
});
