// Every job this rider has: the live ones first, then what they have already
// finished.
//
// **A rider never polls for work.** Assignment happens on the server when the
// shop marks the order READY (`assignRiderIfPossible`, which locks the rider row
// before counting their live jobs), so this list is a view of decisions already
// made, not a queue to claim from. There is no "accept" here and there must
// never be one — the shop's 60-second offer is the only claim in the pipeline,
// and a second one would mean two riders racing for the same parcel.
//
// The split below is the only thing this screen decides. "Now" is the jobs still
// owed something; "Earlier" is history, and it is deliberately not paginated —
// the endpoint returns the most recent 50 and a rider looking further back is
// asking a question the Earnings screen answers better.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  typography,
  Card,
  SectionHeader,
  OrderCard,
  EmptyState,
  Banner,
  connectionMessage,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { isLive, jobStatusLabel, jobStatusTone, formatAddress } from '../../src/job.js';

export default function Jobs() {
  const api = useApi();
  const router = useRouter();
  const { isOnShift } = useSession();

  const jobs = useResource(useCallback(() => api.listJobs(), [api]), { intervalMs: POLL_MS.jobs });

  const all = jobs.data?.jobs ?? [];
  const live = all.filter(isLive);
  const done = all.filter((job) => !isLive(job));

  const problem = connectionMessage(jobs.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={jobs.refreshing} onRefresh={() => jobs.reload()} tintColor={colors.accent} />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => jobs.reload()} /> : null}

      <View>
        <SectionHeader title="Now" action={live.length ? `${live.length}` : undefined} />
        {jobs.loading && !jobs.data ? (
          <SkeletonCard count={2} />
        ) : live.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing to deliver"
              message={
                isOnShift
                  ? 'A delivery is assigned to you when a shop near you finishes packing an order. It will appear here on its own.'
                  : 'You are off shift, so nothing will be assigned to you. Go on shift from the Shift tab.'
              }
            />
          </Card>
        ) : (
          <View style={styles.stack}>
            {live.map((job) => (
              <JobRow key={job.id} job={job} onPress={() => router.push(`/(rider)/job/${job.id}`)} />
            ))}
          </View>
        )}
      </View>

      <View>
        <SectionHeader title="Earlier" />
        {done.length === 0 ? (
          <Card>
            <EmptyState title="No history yet" message="Deliveries you complete are listed here." />
          </Card>
        ) : (
          <View style={styles.stack}>
            {done.map((job) => (
              <JobRow key={job.id} job={job} onPress={() => router.push(`/(rider)/job/${job.id}`)} />
            ))}
          </View>
        )}
        <Text style={styles.footnote}>Your 50 most recent deliveries. Earnings has the full record.</Text>
      </View>
    </ScrollView>
  );
}

function JobRow({ job, onPress }) {
  const collect = job.order?.collectAmount;

  return (
    <OrderCard
      title={job.order?.orderNumber ?? `Job #${job.id}`}
      meta={[job.pickup?.name, formatAddress(job.drop) || job.drop?.city].filter(Boolean).join(' → ')}
      status={job.status}
      statusLabel={jobStatusLabel(job)}
      statusTone={jobStatusTone(job)}
      // What the rider is owed or owes, whichever this job is about. A live COD
      // job shows the cash to collect; a finished one shows what it paid. Never
      // both, because they are not the same money.
      amount={
        isLive(job)
          ? collect
            ? formatINR(collect)
            : undefined
          : job.riderEarning
            ? formatINR(job.riderEarning)
            : undefined
      }
      action={isLive(job) ? 'Open' : 'Details'}
      onPress={onPress}
      footer={isLive(job) && collect ? `Collect ${formatINR(collect)} in cash` : undefined}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  stack: { gap: spacing.md },
  footnote: { ...typography.meta, marginTop: spacing.md, textAlign: 'center' }
});
