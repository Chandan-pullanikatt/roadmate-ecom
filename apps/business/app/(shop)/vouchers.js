// The voucher redemption counter (NO_DELIVERY — gym memberships, §1.9).
//
// Polished in-house against HANDOFF §5 and `designs/Partner.png` (2026-08-07).
//
// This is the whole fulfilment for a NO_DELIVERY order: no rider, no stock, no
// address. The customer walks in with a code, the counter looks it up, and
// redeeming it is the sale becoming final.
//
// Look-up before redeem is deliberate and matches the two endpoints: staff want
// to see whose membership it is and what it covers *before* they honour it, and
// `redeemVoucher` is a claim — it can only ever succeed once, so a double tap
// gets `ALREADY_REDEEMED` rather than two admissions.
//
// What the polish changed:
//
//   • **The verdict is the screen.** Counter staff with a customer in front of
//     them need "honour this / do not honour this" from across the counter, so
//     the result card leads with a full-width valid/used/expired state, not a
//     small pill above a table of dates.
//   • **Expiry is computed and said in words** ("valid for 12 more days"). Two
//     ISO dates rendered as dates make staff do date arithmetic at the till.
//   • **A refresh after a failed redeem re-asks for the voucher we looked up**,
//     not for whatever is currently typed in the box. The old code re-ran the
//     search field, so editing the box after a lookup and then failing a redeem
//     replaced the card with a different voucher's result.
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Button,
  Banner,
  KeyValue,
  Divider,
  EmptyState
} from '@roadmate/ui';
import { useApi } from '../../src/session.js';

/** Why a redemption failed, in the terms counter staff needs. */
const FAILURES = {
  NOT_FOUND: ['No such voucher', 'Check the code and try again.'],
  WRONG_SHOP: ['Not your voucher', 'This membership was bought from a different shop.'],
  ALREADY_REDEEMED: ['Already used', 'This voucher has been redeemed before.'],
  NOT_YET_VALID: ['Not valid yet', 'This membership starts on a later date.'],
  EXPIRED: ['Expired', 'This membership has run out.']
};

export default function Vouchers() {
  const api = useApi();
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notFound, setNotFound] = useState(null);

  /**
   * Takes the code explicitly. The redeem path re-checks *the voucher on screen*
   * after a failure, which is not necessarily what is in the search box.
   */
  const lookupCode = useCallback(
    async (raw) => {
      const trimmed = String(raw ?? '').trim().toUpperCase();
      if (!trimmed) return;
      setBusy('lookup');
      setNotFound(null);
      try {
        const result = await api.lookupVoucher(trimmed);
        setVoucher(result.voucher);
      } catch (error) {
        setVoucher(null);
        // A voucher belonging to another shop comes back as a 404, not a 403 — a
        // shop learns nothing about codes that are not its own.
        setNotFound(error.status === 404 ? 'No voucher with that code at this shop.' : error.message);
      } finally {
        setBusy(null);
      }
    },
    [api]
  );

  const redeem = async () => {
    setBusy('redeem');
    try {
      const result = await api.redeemVoucher(voucher.code);
      setVoucher(result.voucher);
      Alert.alert('Redeemed', 'The membership is now marked as used. Let them in.');
    } catch (error) {
      const [title, message] = FAILURES[error.reason] ?? ['Could not redeem', error.message];
      Alert.alert(title, message);
      // The server's answer is the truth about this voucher's state, so refresh
      // rather than leaving a stale "redeem" button on screen.
      lookupCode(voucher.code);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setCode('');
    setVoucher(null);
    setNotFound(null);
  };

  const verdict = readVerdict(voucher);

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Card style={styles.entry}>
        <Text style={typography.sectionTitle}>Redeem a membership</Text>
        <Text style={typography.meta}>Type the code from the customer's app.</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="RM-XXXX-XXXX"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={() => lookupCode(code)}
          returnKeyType="search"
          accessibilityLabel="Voucher code"
        />
        <Button
          label="Look up"
          onPress={() => lookupCode(code)}
          loading={busy === 'lookup'}
          disabled={!code.trim()}
        />
      </Card>

      {notFound ? (
        <Card>
          <EmptyState title="Not found" message={notFound} />
        </Card>
      ) : null}

      {voucher ? (
        <View style={styles.ticket}>
          {/* The verdict band. This is the thing staff reads; everything under it
              is the detail that backs it up. */}
          <View style={[styles.verdict, { backgroundColor: verdict.bg }]}>
            <Text style={[styles.verdictTitle, { color: verdict.fg }]}>{verdict.title}</Text>
            <Text style={styles.verdictNote}>{verdict.note}</Text>
          </View>

          <View style={styles.stub}>
            <Text style={typography.sku}>VOUCHER CODE</Text>
            <Text style={styles.code}>{voucher.code}</Text>

            <Divider />

            <KeyValue label="Order" value={voucher.orderNumber} />
            <KeyValue label="Customer" value={voucher.customerPhone} />
            <KeyValue label="Valid from" value={formatDate(voucher.validFrom)} />
            <KeyValue label="Valid until" value={formatDate(voucher.validTo)} />
            {voucher.redeemedAt ? <KeyValue label="Redeemed on" value={formatDate(voucher.redeemedAt)} /> : null}

            {voucher.items?.length ? (
              <>
                <Divider />
                <Text style={typography.sku}>COVERS</Text>
                {voucher.items.map((item, index) => (
                  <Text key={index} style={typography.body}>
                    {item.quantity}× {item.productName}
                  </Text>
                ))}
              </>
            ) : null}

            <View style={styles.ticketActions}>
              {verdict.canRedeem ? (
                <Button label="Redeem now" onPress={redeem} loading={busy === 'redeem'} />
              ) : (
                <Banner tone={verdict.tone === 'success' ? 'info' : 'danger'} message={verdict.note} />
              )}
              <Button label="Look up another" variant="secondary" onPress={reset} disabled={busy !== null} />
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * What the counter should do about this voucher.
 *
 * The server is still the authority — `redeemVoucher` re-checks every one of
 * these and this screen renders whatever it says. This is only so staff is not
 * offered a button that is going to fail, and so the window is stated in the
 * unit a human at a till thinks in (days left), not two ISO dates.
 */
function readVerdict(voucher) {
  if (!voucher) return {};
  const now = Date.now();
  const from = voucher.validFrom ? new Date(voucher.validFrom).getTime() : null;
  const to = voucher.validTo ? new Date(voucher.validTo).getTime() : null;

  if (voucher.redeemedAt) {
    return {
      title: 'Already used',
      note: `Redeemed on ${formatDate(voucher.redeemedAt)}. Do not honour it again.`,
      bg: colors.page,
      fg: colors.inkMuted,
      tone: 'neutral',
      canRedeem: false
    };
  }
  if (from && now < from) {
    return {
      title: 'Not valid yet',
      note: `This membership starts on ${formatDate(voucher.validFrom)}.`,
      bg: colors.warningSoft,
      fg: colors.warning,
      tone: 'warning',
      canRedeem: false
    };
  }
  if (to && now > to) {
    return {
      title: 'Expired',
      note: `This membership ran out on ${formatDate(voucher.validTo)}.`,
      bg: colors.dangerSoft,
      fg: colors.danger,
      tone: 'danger',
      canRedeem: false
    };
  }
  const daysLeft = to ? Math.ceil((to - now) / 86400000) : null;
  return {
    title: 'Valid — honour this',
    note:
      daysLeft === null
        ? 'No expiry on this membership.'
        : daysLeft <= 1
          ? 'Valid until the end of today.'
          : `Valid for ${daysLeft} more days.`,
    bg: colors.successSoft,
    fg: colors.success,
    tone: 'success',
    canRedeem: true
  };
}

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  entry: { gap: spacing.md },
  input: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
    color: colors.ink
  },

  ticket: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  verdict: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: 2 },
  verdictTitle: { fontSize: 20, fontWeight: '800' },
  verdictNote: { ...typography.meta, color: colors.ink },

  stub: { padding: spacing.lg, gap: spacing.xs },
  code: { fontSize: 22, fontWeight: '800', letterSpacing: 2, color: colors.ink },

  ticketActions: { gap: spacing.sm, marginTop: spacing.lg }
});
