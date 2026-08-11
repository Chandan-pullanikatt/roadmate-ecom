// Joining RoadMate as a delivery partner (2026-08-11).
//
// Reached only from the sign-in screen, and only with a **ticket** — the
// fifteen-minute proof that the applicant holds the phone number he verified a
// moment ago (`server/src/lib/riderSignupToken.js`). The number is not a field on
// this form and must never become one: the server reads it out of the ticket, so
// nobody can file an application against somebody else's phone.
//
// ── Three steps, because one long screen is where applications die ──────────
//
//   1. **Where you ride.** State → district → area, picked from a list.
//   2. **What you ride, and who you are.** Vehicle, licence, Aadhaar.
//   3. **Documents and payment.** Both optional; then send.
//
// ⚠️ **The area is picked and never typed, and this is the sharpest edge in the
// whole feature.** `districtName` is a free-text column, and `getPendingApprovals`
// matches it against the approving partner's own string **exactly**. An applicant
// who types "Ernakulam District" where his district partner has "Ernakulam" is not
// rejected — he is *invisible* to every approval queue except Master's, forever,
// with nothing anywhere reporting a problem. `GET /api/geo/coverage` returns the
// partners' own strings for precisely this reason, and `register` refuses a
// district it cannot match, so a text input here could only ever produce a 400 the
// picker cannot cause.
//
// An empty coverage list is meaningful and is rendered as such: RoadMate has no
// district partner anywhere yet, so there is nobody who could review an
// application. Saying so is kinder than a picker with nothing in it.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Button,
  Banner,
  Card,
  Chip,
  EmptyState,
  KeyValue
} from '@roadmate/ui';
import { signupApi, captureDocument, uploadsAvailable, documentProblem } from '../src/signup.js';

/**
 * What a rider may ride. Mirrors `VEHICLE_TYPES` on the server, which sends the
 * same list back with the ticket — `verifyOtp`'s `vehicleTypes` is the authority
 * and this is the fallback for a build talking to an older server.
 */
const VEHICLES = ['Bicycle', 'Bike', 'Scooter', 'Auto', 'Mini Truck'];

/** The ones you need a licence and a numberplate for. Mirrors `MOTORISED`. */
const MOTORISED = ['Bike', 'Scooter', 'Auto', 'Mini Truck'];

const STEPS = ['Area', 'You', 'Documents'];

export default function Register() {
  const router = useRouter();
  const { ticket, phone } = useLocalSearchParams();

  const [step, setStep] = useState(0);
  const [coverage, setCoverage] = useState(null); // null = still loading
  const [coverageError, setCoverageError] = useState(null);
  const [canUpload, setCanUpload] = useState(false);

  const [form, setForm] = useState({
    name: '',
    stateName: null,
    districtName: null,
    regionName: null,
    vehicleType: null,
    vehicleNumber: '',
    licenceNumber: '',
    aadhaarNumber: '',
    panNumber: '',
    licenceDocUrl: null,
    aadhaarDocUrl: null,
    upiId: '',
    accountHolder: '',
    accountNumber: '',
    ifscCode: '',
    bankName: ''
  });

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(null); // which field, while it uploads
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // A ticket is the only way onto this screen. Arriving without one — a deep link,
  // a reload — is not an error state worth designing: go back and get one.
  useEffect(() => {
    if (!ticket) router.replace('/sign-in');
  }, [ticket, router]);

  useEffect(() => {
    let cancelled = false;
    signupApi
      .getCoverage()
      .then((res) => {
        if (!cancelled) setCoverage(res.states ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setCoverage([]);
          setCoverageError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probed once, exactly as the job screen probes it: if storage is not configured
  // the document rows are **not rendered** rather than rendered and failing. The
  // API keeps documents optional so that this deployment can still take
  // applications.
  useEffect(() => {
    if (!ticket) return undefined;
    let cancelled = false;
    uploadsAvailable(String(ticket)).then((live) => {
      if (!cancelled) setCanUpload(live);
    });
    return () => {
      cancelled = true;
    };
  }, [ticket]);

  const states = coverage ?? [];
  const districts = useMemo(
    () => states.find((s) => s.state === form.stateName)?.districts ?? [],
    [states, form.stateName]
  );
  const regions = useMemo(
    () => districts.find((d) => d.district === form.districtName)?.regions ?? [],
    [districts, form.districtName]
  );

  const motorised = MOTORISED.includes(form.vehicleType);

  const areaDone = Boolean(form.name.trim().length >= 2 && form.stateName && form.districtName);
  const youDone = Boolean(
    form.vehicleType &&
      /^\d{12}$/.test(form.aadhaarNumber.replace(/\D/g, '')) &&
      (!motorised || (form.vehicleNumber.trim() && form.licenceNumber.trim()))
  );

  const attach = async (field) => {
    setUploading(field);
    setError(null);
    try {
      const url = await captureDocument(String(ticket), { field });
      // null means he backed out of the camera, which is not a failure.
      if (url) set(field, url);
    } catch (err) {
      setError(documentProblem(err));
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signupApi.register(String(ticket), {
        name: form.name.trim(),
        stateName: form.stateName,
        districtName: form.districtName,
        regionName: form.regionName,
        vehicleType: form.vehicleType,
        // Sent as null rather than '' for a bicycle: the server treats an empty
        // string as absent anyway, and null is what "he has none" means.
        vehicleNumber: form.vehicleNumber.trim() || null,
        licenceNumber: form.licenceNumber.trim() || null,
        aadhaarNumber: form.aadhaarNumber,
        panNumber: form.panNumber.trim() || null,
        licenceDocUrl: form.licenceDocUrl,
        aadhaarDocUrl: form.aadhaarDocUrl,
        upiId: form.upiId.trim() || null,
        accountHolder: form.accountHolder.trim() || null,
        accountNumber: form.accountNumber.trim() || null,
        ifscCode: form.ifscCode.trim() || null,
        bankName: form.bankName.trim() || null
      });
      setSent(result.application ?? {});
    } catch (err) {
      // The server's `reason` is what names the problem; its `message` is already a
      // sentence written for the applicant, so it is shown rather than replaced.
      // The two worth translating are the ones whose fix is somewhere else on the
      // form or off it entirely.
      if (err.status === 401) {
        setError('That took longer than 15 minutes. Please verify your mobile number again.');
      } else if (err.reason === 'PHONE_TAKEN') {
        setError('This number now has a RoadMate account. Go back and sign in with it.');
      } else if (err.reason === 'AREA_NOT_COVERED' || err.reason === 'REGION_NOT_COVERED') {
        setStep(0);
        setError(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) return <Sent application={sent} onDone={() => router.replace('/sign-in')} />;

  if (coverage === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={typography.meta}>Loading areas…</Text>
      </View>
    );
  }

  if (states.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="RoadMate is not in your area yet"
          message={
            coverageError
              ? `Could not load the list of areas: ${coverageError}`
              : 'There is no RoadMate district partner taking on delivery partners at the moment, so there would be nobody to review your application. Please try again later.'
          }
          action={<Button label="Back" variant="ghost" onPress={() => router.replace('/sign-in')} />}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={typography.screenTitle}>Join as a delivery partner</Text>
          <Text style={typography.meta}>
            +91 {phone} · step {step + 1} of {STEPS.length} · {STEPS[step]}
          </Text>
        </View>

        <View style={styles.progress}>
          {STEPS.map((label, index) => (
            <View
              key={label}
              style={[styles.progressBar, index <= step && styles.progressBarOn]}
            />
          ))}
        </View>

        {step === 0 ? (
          <View style={styles.form}>
            <Field
              label="Your full name"
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="As printed on your Aadhaar"
              editable={!busy}
            />

            <Picker
              label="State"
              options={states.map((s) => s.state)}
              value={form.stateName}
              onChange={(v) => setForm((f) => ({ ...f, stateName: v, districtName: null, regionName: null }))}
            />

            {form.stateName ? (
              <Picker
                label="District"
                options={districts.map((d) => d.district)}
                value={form.districtName}
                onChange={(v) => setForm((f) => ({ ...f, districtName: v, regionName: null }))}
              />
            ) : null}

            {form.districtName && regions.length > 0 ? (
              <Picker
                label="Area (optional)"
                options={regions}
                value={form.regionName}
                onChange={(v) => set('regionName', v === form.regionName ? null : v)}
              />
            ) : null}

            {/* Not decoration — it is why the pickers are pickers. */}
            <Text style={styles.note}>
              Pick the district you will deliver in. The RoadMate partner for that district is who
              reviews your application.
            </Text>
          </View>
        ) : step === 1 ? (
          <View style={styles.form}>
            <Picker
              label="What will you deliver on?"
              options={VEHICLES}
              value={form.vehicleType}
              onChange={(v) => set('vehicleType', v)}
            />

            {motorised ? (
              <>
                <Field
                  label="Vehicle number"
                  value={form.vehicleNumber}
                  onChangeText={(v) => set('vehicleNumber', v.toUpperCase())}
                  placeholder="KL07AB1234"
                  autoCapitalize="characters"
                  editable={!busy}
                />
                <Field
                  label="Driving licence number"
                  value={form.licenceNumber}
                  onChangeText={(v) => set('licenceNumber', v.toUpperCase())}
                  placeholder="KL0720190001234"
                  autoCapitalize="characters"
                  editable={!busy}
                />
              </>
            ) : (
              <Text style={styles.note}>
                A bicycle needs no licence or number plate, so we will not ask for them.
              </Text>
            )}

            <Field
              label="Aadhaar number"
              value={form.aadhaarNumber}
              onChangeText={(v) => set('aadhaarNumber', v)}
              placeholder="1234 5678 9012"
              keyboardType="number-pad"
              maxLength={14}
              editable={!busy}
            />
            <Field
              label="PAN (optional)"
              value={form.panNumber}
              onChangeText={(v) => set('panNumber', v.toUpperCase())}
              placeholder="ABCDE1234F"
              autoCapitalize="characters"
              editable={!busy}
            />
          </View>
        ) : (
          <View style={styles.form}>
            {canUpload ? (
              <>
                <Text style={typography.sectionTitle}>Photos</Text>
                <Text style={styles.note}>
                  A clear photo of each helps the RoadMate partner approve you faster. You can send
                  your application without them.
                </Text>
                {motorised ? (
                  <DocumentRow
                    label="Driving licence"
                    url={form.licenceDocUrl}
                    busy={uploading === 'licenceDocUrl'}
                    onPress={() => attach('licenceDocUrl')}
                  />
                ) : null}
                <DocumentRow
                  label="Aadhaar card"
                  url={form.aadhaarDocUrl}
                  busy={uploading === 'aadhaarDocUrl'}
                  onPress={() => attach('aadhaarDocUrl')}
                />
              </>
            ) : null}

            <Text style={typography.sectionTitle}>How RoadMate pays you</Text>
            <Text style={styles.note}>
              Optional now — RoadMate pays delivery partners weekly, and you can add this later.
            </Text>
            <Field
              label="UPI ID"
              value={form.upiId}
              onChangeText={(v) => set('upiId', v)}
              placeholder="yourname@upi"
              autoCapitalize="none"
              editable={!busy}
            />
            <Field
              label="Bank account number"
              value={form.accountNumber}
              onChangeText={(v) => set('accountNumber', v)}
              keyboardType="number-pad"
              editable={!busy}
            />
            <Field
              label="IFSC code"
              value={form.ifscCode}
              onChangeText={(v) => set('ifscCode', v.toUpperCase())}
              placeholder="SBIN0001234"
              autoCapitalize="characters"
              editable={!busy}
            />

            <Card style={styles.summary}>
              <Text style={typography.cardTitle}>What you are sending</Text>
              <KeyValue label="Name" value={form.name.trim() || '—'} />
              <KeyValue label="Mobile" value={`+91 ${phone}`} />
              <KeyValue label="District" value={form.districtName ?? '—'} />
              <KeyValue label="Area" value={form.regionName ?? '—'} />
              <KeyValue label="Vehicle" value={form.vehicleType ?? '—'} />
            </Card>
          </View>
        )}

        {error ? <Banner tone="danger" message={error} /> : null}

        <View style={styles.actions}>
          {step === STEPS.length - 1 ? (
            <Button label="Send application" onPress={submit} loading={busy} />
          ) : (
            <Button
              label="Continue"
              onPress={() => setStep((s) => s + 1)}
              disabled={step === 0 ? !areaDone : !youDone}
            />
          )}
          <Button
            label="Back"
            variant="ghost"
            onPress={() => (step === 0 ? router.replace('/sign-in') : setStep((s) => s - 1))}
            disabled={busy}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * What the applicant sees once it is filed. Deliberately not a toast: this is the
 * end of a five-minute form whose result is *nothing visible happening for days*,
 * and the one thing he needs to leave with is how to check back.
 */
function Sent({ application, onDone }) {
  return (
    <View style={styles.center}>
      <EmptyState
        title="Application sent"
        message={`Thank you${application.name ? `, ${application.name}` : ''}. The RoadMate partner for ${
          application.districtName || 'your district'
        } will review it. Sign in with your mobile number any time — the moment you are approved, that same code takes you straight into the app.`}
        action={<Button label="Done" onPress={onDone} />}
      />
    </View>
  );
}

/**
 * A single-select row of chips.
 *
 * Chips rather than a native picker: `@react-native-picker/picker` is a **native
 * module**, and adding one breaks every already-installed dev client until it is
 * rebuilt (HANDOFF §4). These lists are short — a state, its districts, its areas —
 * and a wrapping row of chips reads better on a small screen than a modal wheel.
 */
function Picker({ label, options, value, onChange }) {
  return (
    <View style={styles.field}>
      <Text style={typography.meta}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={value === option}
            onPress={() => onChange(option)}
          />
        ))}
      </View>
    </View>
  );
}

/** Attach-or-replace for one document, with the state of the upload on the row. */
function DocumentRow({ label, url, busy, onPress }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={styles.docRow}>
      <View style={styles.docText}>
        <Text style={typography.cardTitle}>{label}</Text>
        <Text style={typography.meta}>{url ? 'Attached' : 'Not attached'}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Text style={styles.docAction}>{url ? 'Replace' : 'Take photo'}</Text>
      )}
    </Pressable>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={typography.meta}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.inkFaint}
        returnKeyType="done"
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.page,
    padding: spacing.xl
  },

  progress: { flexDirection: 'row', gap: spacing.xs },
  progressBar: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  progressBarOn: { backgroundColor: colors.accent },

  form: { gap: spacing.lg },
  field: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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

  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56
  },
  docText: { gap: 2 },
  docAction: { ...typography.meta, fontWeight: '700', color: colors.info },

  summary: { gap: spacing.xs },
  note: { ...typography.meta, lineHeight: 18 },
  actions: { gap: spacing.sm }
});
