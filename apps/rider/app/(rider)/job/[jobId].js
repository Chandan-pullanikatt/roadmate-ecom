// One delivery, end to end. The screen the app exists for.
//
// The ladder is two rungs and no more (see `src/job.js`):
//
//     ASSIGNED ──[I have collected it]──▶ EN_ROUTE_DROP ──[OTP]──▶ DELIVERED
//
// Four things it has to get right, all of them about not lying to the rider:
//
//   • **The OTP is the delivery, not a formality.** It is the only thing
//     separating "delivered" and "marked delivered", and `deliver()` answers 422
//     on a wrong code without moving the order. There is no skip, no "customer
//     not available, mark anyway", and no override — because there is none in
//     the API and inventing one on the client would mean a screen offering
//     something that cannot happen. A customer who has no code has not received
//     their order; that situation is a dead run.
//   • **Delivering is the moment money moves.** That one call drops the shop's
//     stock, freezes the commission split, freezes this rider's fee, and — on a
//     COD order — records the cash as being in this rider's hands. So the button
//     names the cash before it is pressed, and the confirmation says the amount.
//     A rider who taps Delivered without having collected ₹840 is short ₹840.
//   • **A dead run is a real outcome, reachable without shame.** The trip was
//     made; the platform pays for it. Burying it would push riders towards
//     marking an undelivered order delivered, which is the one thing that
//     corrupts the ledger silently.
//   • **A 409 explains itself.** Picking up before the shop is READY is not an
//     error the rider caused — the bag does not exist yet. The response carries
//     `orderStatus` and this screen says which shop is still packing.
//
// ✅ **Photo and signature landed 2026-08-09**, with Cloudinary. `deliver()` did
// not change — it has always taken `photoUrl` and `signatureUrl` (PLAN §6) — so
// the app uploads first and sends two URLs. Two rules carried over unchanged:
// the proof section is **not rendered at all** when the server has no storage
// credentials (no affordance that cannot work), and proof stays **optional**,
// because the OTP is the delivery and a refused camera permission must never be
// what makes an order undeliverable. See `src/proof.js`.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Linking,
  ActivityIndicator,
  StyleSheet
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  SectionHeader,
  StatusPill,
  KeyValue,
  Divider,
  Button,
  Banner,
  connectionMessage,
  StickyFooter,
  SkeletonCard,
  EmptyState,
  formatINR,
  sizedImage
} from '@roadmate/ui';
import { useApi } from '../../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../../src/config.js';
import {
  isLive,
  nextStep,
  jobStatusLabel,
  jobStatusTone,
  formatAddress,
  mapsUrl,
  telUrl
} from '../../../src/job.js';
import {
  useUploadsAvailable,
  capturePhoto,
  uploadSignature,
  uploadProblem
} from '../../../src/proof.js';
import SignaturePad from '../../../src/SignaturePad.js';
import { signatureToDataUri } from '@roadmate/api';

export default function JobDetail() {
  const { jobId } = useLocalSearchParams();
  const api = useApi();
  const router = useRouter();

  const [busy, setBusy] = useState(null);
  const [otpOpen, setOtpOpen] = useState(false);

  // Proof of delivery. Held here rather than in the OTP sheet because it is
  // collected at the door *before* the code is read out, and because a photo
  // survives the sheet being closed and reopened.
  const uploadsAvailable = useUploadsAvailable(api);
  const [proof, setProof] = useState({ photoUrl: null, signatureUrl: null });
  const [signing, setSigning] = useState(false);

  // There is no `GET /api/rider/jobs/:id`, and adding one would be a second
  // description of the same row. The list endpoint is small (50 jobs, one
  // rider) and already returns the whole job card, so this screen reads from it
  // and polls at the same rate — which also means the list behind it is fresh
  // when the rider goes back.
  const jobs = useResource(useCallback(() => api.listJobs(), [api]), {
    cacheKey: 'jobs',
    intervalMs: POLL_MS.jobs
  });
  const job = useMemo(
    () => (jobs.data?.jobs ?? []).find((j) => String(j.id) === String(jobId)) ?? null,
    [jobs.data, jobId]
  );

  const problem = connectionMessage(jobs.error);

  if (jobs.loading && !jobs.data) {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <SkeletonCard count={3} />
      </ScrollView>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="This delivery is not yours"
          message="It may have been handed to another rider, or the order was cancelled. Your current jobs are in the Jobs tab."
          action={<Button label="Back to jobs" variant="ghost" onPress={() => router.replace('/(rider)/jobs')} />}
        />
      </View>
    );
  }

  const step = nextStep(job);
  const collect = job.order?.collectAmount;

  /**
   * Every action here is a state change the server may refuse. This is the one
   * place that knows what each refusal means, so no button has to.
   *
   * `withPause` is not optional: without it the 10-second poll can land
   * mid-pickup and put the screen back to the step the rider just left.
   */
  const act = (key, action) =>
    jobs.withPause(async () => {
      setBusy(key);
      try {
        await action();
        return true;
      } catch (error) {
        if (error.status === 422) {
          Alert.alert('That code is not right', 'Ask the customer to read out the 4-digit code again.');
        } else if (error.isConflict) {
          // The two 409s a rider can actually hit, told apart by the body the
          // API sends back rather than by guessing from the status alone.
          const orderStatus = error.body?.orderStatus;
          Alert.alert(
            'Not yet',
            orderStatus && orderStatus !== 'READY'
              ? `${job.pickup?.name ?? 'The shop'} has not finished packing this order. It is ${String(
                  orderStatus
                ).toLowerCase()} right now — wait for them to hand it over.`
              : error.message
          );
        } else if (error.isNetwork) {
          Alert.alert('No connection', 'Could not reach RoadMate. Check the connection and try again.');
        } else {
          Alert.alert('Could not do that', error.message);
        }
        return false;
      } finally {
        setBusy(null);
      }
    });

  const collectFromShop = () => act('pickup', () => api.pickUp(job.id));

  /**
   * Attaching proof is not a state change on the server — nothing is recorded
   * until `deliver()` — so it does not go through `act`. It still pauses the
   * poll, because a refresh landing while the camera is open would re-render
   * this screen out from under it.
   */
  const attachPhoto = (fromLibrary) =>
    jobs.withPause(async () => {
      setBusy(fromLibrary ? 'library' : 'photo');
      try {
        const url = await capturePhoto(api, { jobId: job.id, fromLibrary });
        if (url) setProof((p) => ({ ...p, photoUrl: url }));
      } catch (error) {
        Alert.alert('Could not attach the photo', uploadProblem(error));
      } finally {
        setBusy(null);
      }
    });

  const attachSignature = (strokes, size) =>
    jobs.withPause(async () => {
      setBusy('signature');
      try {
        const url = await uploadSignature(api, {
          jobId: job.id,
          dataUri: signatureToDataUri(strokes, size)
        });
        setProof((p) => ({ ...p, signatureUrl: url }));
        setSigning(false);
      } catch (error) {
        Alert.alert('Could not attach the signature', uploadProblem(error));
      } finally {
        setBusy(null);
      }
    });

  const deliver = async ({ otpCode, note }) => {
    const done = await act('deliver', () =>
      api.deliver(job.id, {
        otpCode,
        note: note || undefined,
        // Omitted rather than sent as null when there is none: the endpoint
        // treats absent as "no proof", and a null would be the same thing said
        // less clearly.
        ...(proof.photoUrl ? { photoUrl: proof.photoUrl } : {}),
        ...(proof.signatureUrl ? { signatureUrl: proof.signatureUrl } : {})
      })
    );
    if (done) {
      setOtpOpen(false);
      Alert.alert(
        'Delivered',
        collect
          ? `Make sure you have the ${formatINR(collect)}. It is now recorded as cash in your hands until you hand it in.`
          : 'Nicely done.'
      );
    }
    return done;
  };

  const deadRun = () =>
    Alert.alert(
      'Report a dead run?',
      'Use this when there was nothing to collect, or nobody to deliver to. The order is cancelled, the shop gets its stock back, and RoadMate pays you for the trip you made.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => act('dead', () => api.reportDeadRun(job.id, 'Reported from the rider app'))
        }
      ]
    );

  return (
    <>
      <ScrollView contentContainerStyle={styles.wrap}>
        {problem ? <Banner message={problem} action="Retry" onAction={() => jobs.reload()} /> : null}

        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.orderNumber}>{job.order?.orderNumber ?? `Job #${job.id}`}</Text>
            <Text style={typography.meta}>
              {[
                job.order?.itemCount ? `${job.order.itemCount} item${job.order.itemCount === 1 ? '' : 's'}` : null,
                job.distanceKm != null ? `${Number(job.distanceKm).toFixed(1)} km` : null
              ]
                .filter(Boolean)
                .join(' • ')}
            </Text>
          </View>
          <StatusPill label={jobStatusLabel(job)} tone={jobStatusTone(job)} />
        </View>

        {/* Cash first, and unmissable. It is the single thing that costs a rider
            their own money if they get it wrong. */}
        {collect ? (
          <View style={styles.cash}>
            <Text style={styles.cashLabel}>Collect at the door</Text>
            <Text style={styles.cashAmount}>{formatINR(collect)}</Text>
            <Text style={styles.cashNote}>Cash on delivery. Hand it in from the Cash tab.</Text>
          </View>
        ) : (
          <Card style={styles.paidCard}>
            <Text style={typography.body}>Already paid online. Collect nothing.</Text>
          </Card>
        )}

        <View>
          <SectionHeader title="1 · Collect from" />
          <Card>
            <Text style={typography.cardTitle}>{job.pickup?.name ?? 'Shop'}</Text>
            <View style={styles.rowActions}>
              {mapsUrl(job.pickup?.latitude, job.pickup?.longitude) ? (
                <Button
                  label="Navigate"
                  variant="ghost"
                  onPress={() => Linking.openURL(mapsUrl(job.pickup.latitude, job.pickup.longitude))}
                  style={styles.rowAction}
                />
              ) : null}
              {telUrl(job.pickup?.phone) ? (
                <Button
                  label="Call shop"
                  variant="ghost"
                  onPress={() => Linking.openURL(telUrl(job.pickup.phone))}
                  style={styles.rowAction}
                />
              ) : null}
            </View>
          </Card>
        </View>

        <View>
          <SectionHeader title="2 · Deliver to" />
          <Card>
            <Text style={typography.body}>{formatAddress(job.drop) || 'Address unavailable'}</Text>
            {job.drop?.landmark ? <Text style={typography.meta}>Near {job.drop.landmark}</Text> : null}
            <View style={styles.rowActions}>
              {mapsUrl(job.drop?.latitude, job.drop?.longitude) ? (
                <Button
                  label="Navigate"
                  variant="ghost"
                  onPress={() => Linking.openURL(mapsUrl(job.drop.latitude, job.drop.longitude))}
                  style={styles.rowAction}
                />
              ) : null}
            </View>
          </Card>
        </View>

        <Card>
          <KeyValue label="Payment" value={job.order?.paymentMethod === 'COD' ? 'Cash on delivery' : 'Paid online'} />
          <Divider />
          <KeyValue label="Order status" value={job.order?.status ?? '—'} />
          {/* A rider's own fee, only once it exists. It is written at delivery
              and frozen — never recomputed here, so this figure and the ledger
              cannot disagree. Zero for a shop's own delivery boy, who is paid by
              his shop, so it is simply not shown to him. */}
          {job.riderEarning && Number(job.riderEarning) > 0 ? (
            <>
              <Divider />
              <KeyValue label="You earned" value={formatINR(job.riderEarning)} strong />
            </>
          ) : null}
        </Card>

        {/* Proof of delivery. Rendered only when the server actually has file
            storage — `uploadsAvailable` is null while that is still being
            asked, false on a deployment without credentials, and in neither
            case does a camera button appear. */}
        {isLive(job) && uploadsAvailable ? (
          <View>
            <SectionHeader title="3 · Proof (optional)" />
            <Card>
              <Text style={typography.meta}>
                The code is what completes the delivery. A photo or a signature is extra evidence if
                anyone questions it later.
              </Text>

              {proof.photoUrl ? (
                <View style={styles.proofRow}>
                  <Image
                    source={{ uri: sizedImage(proof.photoUrl, { width: 56, height: 56 }) }}
                    style={styles.thumb}
                  />
                  <View style={styles.proofText}>
                    <Text style={typography.body}>Photo attached</Text>
                    <Text style={typography.meta}>Sent with the delivery.</Text>
                  </View>
                </View>
              ) : null}

              {/* No thumbnail for the signature: it is an SVG, and React
                  Native's Image does not render SVG without another native
                  module. The rider watched it being drawn a second ago; a
                  broken image frame would say less than this line does. */}
              {proof.signatureUrl ? (
                <View style={styles.proofRow}>
                  <View style={styles.proofText}>
                    <Text style={typography.body}>Signature attached</Text>
                    <Text style={typography.meta}>Sent with the delivery.</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.rowActions}>
                <Button
                  label={proof.photoUrl ? 'Retake photo' : 'Take photo'}
                  variant="ghost"
                  onPress={() => attachPhoto(false)}
                  loading={busy === 'photo'}
                  disabled={busy !== null}
                  style={styles.rowAction}
                />
                <Button
                  label={proof.signatureUrl ? 'Sign again' : 'Signature'}
                  variant="ghost"
                  onPress={() => setSigning(true)}
                  disabled={busy !== null}
                  style={styles.rowAction}
                />
              </View>
            </Card>
          </View>
        ) : null}

        {isLive(job) ? (
          <Button label="Report a dead run" variant="danger" onPress={deadRun} loading={busy === 'dead'} />
        ) : null}
      </ScrollView>

      {/* The forward action is pinned: on a long job card it was below the fold,
          and a late tap burns the customer's promised ETA (HANDOFF §5). */}
      {step ? (
        <StickyFooter>
          <Text style={styles.stepHint}>{step.hint}</Text>
          <Button
            label={step.label}
            onPress={step.key === 'pickup' ? collectFromShop : () => setOtpOpen(true)}
            loading={busy === 'pickup'}
            disabled={busy !== null}
          />
        </StickyFooter>
      ) : null}

      <OtpSheet
        visible={otpOpen}
        onClose={() => setOtpOpen(false)}
        onSubmit={deliver}
        busy={busy === 'deliver'}
        collect={collect}
        proof={proof}
      />

      <Modal visible={signing} animationType="slide" transparent onRequestClose={() => setSigning(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <SignaturePad
              busy={busy === 'signature'}
              onCancel={() => setSigning(false)}
              onDone={attachSignature}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * The delivery confirmation. Four digits the customer reads out, and an optional
 * note.
 *
 * The note says what a photo cannot — "left with the watchman", "handed to a
 * neighbour". It is still the most useful half of proof-of-delivery, and it is
 * here rather than on the job card because it describes the handover that is
 * happening at this exact moment.
 */
function OtpSheet({ visible, onClose, onSubmit, busy, collect, proof }) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');

  const close = () => {
    setCode('');
    setNote('');
    onClose();
  };

  const submit = async () => {
    const done = await onSubmit({ otpCode: code.trim(), note: note.trim() });
    if (done) {
      setCode('');
      setNote('');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>Delivery code</Text>
          <Text style={typography.meta}>
            Ask the customer for the 4-digit code in their app. It is the only way to close this
            delivery.
          </Text>

          <TextInput
            style={styles.otp}
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            placeholder="0000"
            placeholderTextColor={colors.inkFaint}
          />

          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional) — e.g. left with the watchman"
            placeholderTextColor={colors.inkFaint}
            multiline
            maxLength={300}
          />

          {proof?.photoUrl || proof?.signatureUrl ? (
            <Text style={typography.meta}>
              {[proof.photoUrl ? 'Photo' : null, proof.signatureUrl ? 'signature' : null]
                .filter(Boolean)
                .join(' and ')}{' '}
              will be attached to this delivery.
            </Text>
          ) : null}

          {collect ? (
            <View style={styles.sheetCash}>
              <Text style={styles.sheetCashText}>
                Collect {formatINR(collect)} in cash before you confirm. It is recorded against you the
                moment you do.
              </Text>
            </View>
          ) : null}

          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={close} disabled={busy} style={styles.sheetAction} />
            <Button
              label="Confirm delivery"
              onPress={submit}
              loading={busy}
              disabled={code.length !== 4 || busy}
              style={styles.sheetAction}
            />
          </View>
          {busy ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: 140 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  orderNumber: { fontSize: 20, fontWeight: '700', color: colors.ink },

  cash: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 2
  },
  cashLabel: { ...typography.sku, color: colors.warning },
  cashAmount: { fontSize: 28, fontWeight: '800', color: colors.ink },
  cashNote: { ...typography.meta },
  paidCard: { alignItems: 'flex-start' },

  rowActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  rowAction: { flex: 1 },

  proofRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.md },
  proofText: { flex: 1, gap: 2 },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.page },

  stepHint: { ...typography.meta, textAlign: 'center', marginBottom: spacing.sm },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md
  },
  otp: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.page,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 12,
    textAlign: 'center',
    color: colors.ink,
    paddingVertical: spacing.md
  },
  note: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top'
  },
  sheetCash: { backgroundColor: colors.warningSoft, borderRadius: radius.sm, padding: spacing.md },
  sheetCashText: { ...typography.meta, color: colors.ink },
  sheetActions: { flexDirection: 'row', gap: spacing.md },
  sheetAction: { flex: 1 }
});
