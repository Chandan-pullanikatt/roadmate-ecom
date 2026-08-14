// The network: who this executive has onboarded, and who is waiting to be.
//
// Polished in-house against HANDOFF §5 and `designs/Partner.png` (2026-08-07).
// It is not a decorative screen: `getPendingApprovals` is a queue with nobody
// watching it on a phone, and a shop that has signed up but not been approved is
// `isActive: false`, which means it is invisible to `rankCandidateShops` and
// cannot receive a single customer order. Approving is the highest-value thing a
// regional partner does all week — so the polish makes the pending queue the
// loudest thing here and the settled network the quiet list underneath it.
//
// Two things this screen is deliberate about, both unchanged by the visual pass:
//
//   • **Reject deletes the account.** `rejectPartner` is `prisma.user.delete`,
//     not a flag — there is no rejected state to come back from, and the person
//     must sign up again from scratch. It is behind a confirmation that says so
//     in those words, and the polish put the same sentence on the card itself so
//     it is read before the tap rather than after it.
//   • **Approve is not a claim.** Unlike everything in the B2C pipeline, this
//     endpoint is a plain `update` with no conditional WHERE, so two taps are
//     idempotent rather than racy — approving an already-approved user just
//     sets `isActive: true` again. Nothing here needs the 409 discipline the
//     shop screens live by, and pretending otherwise would be cargo cult.
//
// One fix the polish surfaced: the busy flag was keyed on the partner id alone,
// so rejecting a partner put the spinner on that row's **Approve** button. It is
// now keyed on the verb as well.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, RefreshControl, Alert, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  StatusPill,
  SectionHeader,
  EmptyState,
  Button,
  Banner,
  connectionMessage,
  SearchField,
  SkeletonCard,
  Avatar,
  formatAmount,
  shadowLift
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { roleConfig } from '../../src/roles.js';

export default function Network() {
  const { user } = useSession();
  const api = useApi();
  const config = roleConfig(user?.role);
  const [busy, setBusy] = useState(null); // { id, verb } — see the header note
  const [search, setSearch] = useState('');

  const pending = useResource(useCallback(() => api.getPendingApprovals(), [api]), {
    cacheKey: 'pending-approvals'
  });
  const active = useResource(useCallback(() => api.getActivePartners(), [api]), {
    cacheKey: 'active-partners'
  });

  const pendingList = pending.data?.approvals ?? [];
  const activeList = active.data?.partners ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return activeList;
    return activeList.filter((p) =>
      `${p.businessName ?? ''} ${p.name ?? ''} ${p.phone ?? ''} ${p.email ?? ''} ${p.districtName ?? ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [activeList, search]);

  const reloadAll = () => {
    pending.reload();
    active.reload();
  };

  const decide = (partner, approve) => {
    const run = () =>
      pending.withPause(async () => {
        setBusy({ id: partner.id, verb: approve ? 'approve' : 'reject' });
        try {
          if (approve) await api.approvePartner(partner.id);
          else await api.rejectPartner(partner.id);
          active.reload();
        } catch (error) {
          Alert.alert('Could not update', error.message);
        } finally {
          setBusy(null);
        }
      });

    if (approve) return run();

    Alert.alert(
      `Reject ${partner.businessName || partner.name}?`,
      'This deletes their account. They will have to sign up again from scratch — there is no way to undo it from here.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject and delete', style: 'destructive', onPress: run }
      ]
    );
  };

  const loading = (pending.loading && !pending.data) || (active.loading && !active.data);
  const problem = connectionMessage(pending.error ?? active.error);

  const sections = [
    { key: 'pending', title: 'Waiting for approval', count: pendingList.length, data: pendingList },
    { key: 'active', title: 'Your network', count: activeList.length, data: filtered }
  ];

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <SkeletonCard count={2} />
        <SkeletonCard count={3} />
      </View>
    );
  }

  return (
    <SectionList
      style={styles.flex}
      contentContainerStyle={styles.list}
      sections={sections}
      keyExtractor={(partner) => String(partner.id)}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={pending.refreshing} onRefresh={reloadAll} tintColor={colors.accent} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {problem ? <Banner message={problem} action="Retry" onAction={reloadAll} /> : null}
          {/* A pending partner earns the platform nothing until someone taps
              Approve. Worth a banner, not just a section header. */}
          {pendingList.length > 0 ? (
            <Banner
              message={`${pendingList.length} partner${
                pendingList.length === 1 ? '' : 's'
              } cannot trade until you approve ${pendingList.length === 1 ? 'them' : 'them'}.`}
            />
          ) : null}
          {activeList.length > 6 ? (
            <SearchField value={search} onChangeText={setSearch} placeholder="Search your network" />
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <SectionHeader title={section.title} action={section.count ? String(section.count) : undefined} />
      )}
      renderSectionFooter={({ section }) =>
        section.data.length === 0 ? (
          <Card style={styles.emptyCard}>
            <EmptyState
              title={
                section.key === 'pending'
                  ? 'Nothing waiting'
                  : search
                    ? 'Nobody matches'
                    : 'Nobody yet'
              }
              message={
                section.key === 'pending'
                  ? 'New shops and riders who sign up under you appear here first.'
                  : search
                    ? 'Try a name, phone number or district.'
                    : `Approved partners appear here. ${
                        config.sells ? 'These are the shops you supply.' : 'These are the shops and riders you onboarded.'
                      }`
              }
            />
          </Card>
        ) : (
          <View style={styles.gap} />
        )
      }
      renderItem={({ item: partner, section }) =>
        section.key === 'pending' ? (
          <PendingCard partner={partner} busy={busy} onDecide={decide} />
        ) : (
          <ActiveCard partner={partner} showsCredit={config.showsCredit} />
        )
      }
    />
  );
}

/** The queue. Accent-edged, like the shop's offer card, for the same reason. */
function PendingCard({ partner, busy, onDecide }) {
  const mine = busy?.id === partner.id;
  return (
    <View style={styles.pendingCard}>
      <View style={styles.identity}>
        <Avatar name={partner.businessName || partner.name} />
        <View style={styles.identityText}>
          <Text style={typography.sku}>{roleLabel(partner)}</Text>
          <Text style={typography.cardTitle} numberOfLines={2}>
            {partner.businessName || partner.name}
          </Text>
          <Text style={typography.meta}>
            {[partner.regionName, partner.districtName].filter(Boolean).join(' · ') || 'No territory set'}
          </Text>
        </View>
        <StatusPill tone="warning" label="Pending" />
      </View>

      <View style={styles.contact}>
        {partner.phone ? <Text style={typography.meta}>{partner.phone}</Text> : null}
        {partner.email ? <Text style={typography.meta}>{partner.email}</Text> : null}
      </View>

      {/* Said here as well as in the confirmation. The confirmation is read
          after the decision to tap; this is read before it. */}
      <Text style={styles.warning}>Rejecting deletes their account. It cannot be undone.</Text>

      <View style={styles.actions}>
        <Button
          label="Reject"
          variant="danger"
          style={styles.action}
          loading={mine && busy.verb === 'reject'}
          disabled={mine}
          onPress={() => onDecide(partner, false)}
        />
        <Button
          label="Approve"
          style={styles.action}
          loading={mine && busy.verb === 'approve'}
          disabled={mine}
          onPress={() => onDecide(partner, true)}
        />
      </View>
    </View>
  );
}

function ActiveCard({ partner, showsCredit }) {
  const credit = showsCredit && hasCredit(partner);
  return (
    <Card style={styles.activeCard}>
      <View style={styles.identity}>
        <Avatar name={partner.businessName || partner.name} size={36} />
        <View style={styles.identityText}>
          <Text style={typography.sku}>{roleLabel(partner)}</Text>
          <Text style={typography.cardTitle} numberOfLines={2}>
            {partner.businessName || partner.name}
          </Text>
          <Text style={typography.meta} numberOfLines={1}>
            {[partner.districtName, partner.phone].filter(Boolean).join(' · ') || partner.email}
          </Text>
        </View>
        <StatusPill tone="success" label="Active" />
      </View>

      {/* The designed Distributor screen shows a shop's outstanding balance and
          credit available. Those columns ride along on `getActivePartners`' full
          user rows, so this needs no endpoint — but only a distributor is owed
          money by a shop, so only a distributor is shown it. B2B `Float`, hence
          `formatAmount`. */}
      {credit ? (
        <View style={styles.creditRow}>
          <View style={styles.creditCell}>
            <Text style={typography.sku}>OUTSTANDING</Text>
            <Text style={[typography.money, overLimit(partner) && { color: colors.danger }]}>
              {formatAmount(partner.outstandingDue ?? 0)}
            </Text>
          </View>
          <View style={styles.creditRule} />
          <View style={styles.creditCell}>
            <Text style={typography.sku}>CREDIT LIMIT</Text>
            <Text style={typography.money}>{formatAmount(partner.creditLimit ?? 0)}</Text>
          </View>
          {overLimit(partner) ? <StatusPill tone="danger" label="Over limit" /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** A partner with neither figure set has nothing to say — don't show ₹0.00/₹0.00. */
const hasCredit = (partner) => Boolean(partner.creditLimit) || Boolean(partner.outstandingDue);

const overLimit = (partner) => (partner.outstandingDue ?? 0) > (partner.creditLimit ?? 0);

/** "SHOP" → "Shop"; a delivery executive is a rider and should read as one. */
const roleLabel = (partner) => {
  if (partner.role === 'EXECUTIVE') {
    return partner.executiveType === 'DELIVERY' ? 'Rider' : 'Field executive';
  }
  return String(partner.role ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/(^|\s)\w/g, (c) => c.toUpperCase());
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loadingWrap: { flex: 1, backgroundColor: colors.page, padding: spacing.lg, gap: spacing.lg },
  header: { gap: spacing.md, marginBottom: spacing.lg },
  gap: { height: spacing.lg },
  emptyCard: { marginBottom: spacing.lg },

  pendingCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
    // `shadowLift`, not a hand-rolled shadow. Same role as the shop's offer card
    // — the thing needing attention — so it gets the same elevation from the same
    // token rather than a third set of numbers (see `tokens.js`).
    ...shadowLift
  },
  activeCard: { marginBottom: spacing.md, gap: spacing.md },

  identity: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  contact: { gap: 2 },
  warning: { ...typography.meta, color: colors.danger },

  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },

  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md
  },
  creditCell: { gap: 2 },
  creditRule: { width: 1, height: 28, backgroundColor: colors.border }
});
