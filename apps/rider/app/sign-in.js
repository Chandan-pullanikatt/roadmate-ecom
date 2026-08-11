// Rider sign-in: a phone number and a code — and, for the first time, a way in
// for somebody who has no account yet (2026-08-11).
//
// ── What changed, and why ───────────────────────────────────────────────────
//
// This screen used to ask for a password. That was always the wrong credential
// for this audience: a delivery partner did not choose it, somebody else did —
// a field executive who left the field blank and got `password123`, or a shop
// owner who typed one and read it out — and there was no reset anywhere on the
// platform. "What is this rider's password" had no good answer.
//
// So the door is now the same one the Customer app uses: the phone number, which
// is the only credential every rider reliably has, and a code sent to it.
//
// ⚠️ **The password field is still here, behind a link, and must stay.** Riders
// onboarded before self-registration have passwords — and a rider whom a field
// executive onboarded with an email address and *no phone number* has no other way
// in at all. Leading with the OTP is right; removing the alternative would lock
// real accounts out of the app.
//
// ── Four answers behind one code ────────────────────────────────────────────
//
// `verifyOtp` returns an `outcome`, and this screen renders a different thing for
// each. That branch is the feature:
//
//   SIGNED_IN    an approved rider. Store the session; the redirect does the rest.
//   NEW          nobody has this number → go and register.
//   PENDING      already applied. **No token, on purpose** — there is nothing to
//                sign in to yet. Re-entering the code is how a rider checks back,
//                which is why this screen shows the application rather than a
//                bare "still waiting".
//   DEACTIVATED  the account exists and was switched off. A completely different
//                sentence from PENDING: telling somebody a shop released that they
//                are "pending" leaves them waiting on a decision already made.
//
// A 403 `WRONG_APP` is not an outcome but an error, and the one place `APP_FOR_ROLE`
// is consulted outside `index.js` — a shop owner handed the wrong APK needs to be
// told which app is his before he starts guessing passwords.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  StyleSheet
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { colors, spacing, radius, typography, Button, Banner, Card, KeyValue, BrandMark } from '@roadmate/ui';
import { useSession } from '../src/session.js';
import { signupApi } from '../src/signup.js';

/** Mirrors `normalizePhone` on the server, for the button's enabled state only. */
const isPhone = (raw) => /^[6-9]\d{9}$/.test(String(raw).replace(/\D/g, '').slice(-10));

/** Which app this person should have instead. The mirror of `index.js`'s table. */
const APP_FOR_ROLE = {
  SHOP: 'RoadMate Shop',
  MANUFACTURER: 'RoadMate Manufacturer',
  DISTRIBUTOR: 'RoadMate Distributor',
  REGIONAL: 'RoadMate Regional'
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function SignIn() {
  const { signIn, adoptSession, isSignedIn, loading: restoring } = useSession();
  const router = useRouter();

  // 'otp' is the door; 'password' is the older one, for accounts that predate it.
  const [mode, setMode] = useState('otp');
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [outcome, setOutcome] = useState(null); // PENDING / DEACTIVATED, once known

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const codeInput = useRef(null);

  // Only about *this* screen's resend button. The code lives 5 minutes and the
  // server is the authority on both; this stops a rider spending all five of his
  // requests before the first SMS has landed.
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  if (!restoring && isSignedIn) return <Redirect href="/" />;

  const digits = phone.replace(/\D/g, '').slice(-10);
  const trimmedIdentifier = identifier.trim();

  const send = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await signupApi.requestOtp(digits);
      setDevCode(result.code ?? null);
      setStep('code');
      setSecondsLeft(30);
      setTimeout(() => codeInput.current?.focus(), 150);
    } catch (err) {
      setError(
        err.status === 429
          ? 'Too many codes requested for this number. Please try again in a few minutes.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signupApi.verifyOtp(digits, code.trim());

      if (result.outcome === 'SIGNED_IN') {
        // No navigation here: the session flipping to signed-in re-renders the
        // redirect above, so there is one route decision and not two.
        await adoptSession(result.token, result.user);
        return;
      }

      if (result.outcome === 'NEW') {
        // The ticket is handed to the form as a parameter rather than stored: it is
        // good for fifteen minutes and for one application (`src/signup.js`).
        router.push({
          pathname: '/register',
          params: { ticket: result.ticket, phone: digits }
        });
        return;
      }

      // PENDING / DEACTIVATED — rendered below instead of navigating. There is no
      // session to route with, and this is already the "you are not in yet" screen.
      setOutcome(result);
    } catch (err) {
      if (err.status === 403 && err.reason === 'WRONG_APP') {
        const shouldHave = APP_FOR_ROLE[err.body?.role] ?? null;
        setError(
          shouldHave
            ? `This number is registered as a ${shouldHave} account. Install ${shouldHave} and sign in there — RoadMate Rider is only for delivery partners.`
            : 'This number is registered to a RoadMate account that is not a delivery partner. Your role works from the web dashboard.'
        );
      } else {
        setError(
          err.status === 429
            ? 'That code has been locked after too many wrong attempts. Ask for a new one.'
            : err.message
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(trimmedIdentifier, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /** Purely advisory — the server gives one answer for every kind of failure. */
  const passwordHint = useMemo(() => {
    if (!trimmedIdentifier) return 'Whichever your RoadMate contact registered for you.';
    return /^[+\d][\d\s\-()]*$/.test(trimmedIdentifier)
      ? 'Signing in with your phone number.'
      : 'Signing in with your email address.';
  }, [trimmedIdentifier]);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        {/* The client's actual mark, shared from `@roadmate/ui` (2026-08-11).
            This was a 56 dp yellow square standing in for a logo the Customer app
            had all along. */}
        <BrandMark title="RoadMate Rider" tagline="For delivery partners" />

        {outcome ? (
          <ApplicationStatus
            outcome={outcome}
            onBack={() => {
              setOutcome(null);
              setStep('phone');
              setCode('');
              setDevCode(null);
            }}
          />
        ) : mode === 'otp' ? (
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={typography.meta}>Mobile number</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.prefix}>+91</Text>
                <TextInput
                  style={styles.phoneInput}
                  value={phone}
                  onChangeText={(next) => {
                    setPhone(next);
                    // Editing the number invalidates the code sent to the old one.
                    // Going back to step one is the honest thing to do.
                    if (step === 'code') {
                      setStep('phone');
                      setCode('');
                      setDevCode(null);
                    }
                  }}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  placeholder="9876500011"
                  placeholderTextColor={colors.inkFaint}
                  maxLength={14}
                  editable={!busy}
                />
              </View>
            </View>

            {step === 'phone' ? (
              <Button label="Send code" onPress={send} loading={busy} disabled={!isPhone(digits)} />
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={typography.meta}>6-digit code</Text>
                  <TextInput
                    ref={codeInput}
                    style={styles.codeInput}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    autoComplete="sms-otp"
                    textContentType="oneTimeCode"
                    placeholder="••••••"
                    placeholderTextColor={colors.inkFaint}
                    maxLength={6}
                    editable={!busy}
                    onSubmitEditing={verify}
                  />
                </View>

                {devCode ? (
                  <Banner
                    tone="info"
                    message={`Development build — SMS is not connected yet, so your code is ${devCode}.`}
                  />
                ) : null}

                <Button label="Continue" onPress={verify} loading={busy} disabled={code.trim().length < 4} />

                <Pressable onPress={send} disabled={busy || secondsLeft > 0} hitSlop={8}>
                  <Text style={[styles.resend, (busy || secondsLeft > 0) && styles.resendOff]}>
                    {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
                  </Text>
                </Pressable>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* The link that replaces the old footnote. It used to say there was no
                self-signup and to ask your regional contact; there is one now, and
                the same code that signs a rider in is the one that starts it. */}
            <Text style={styles.footnote}>
              New to RoadMate? Enter your number and we will take you through joining as a
              delivery partner.
            </Text>

            <Pressable onPress={() => { setMode('password'); setError(null); }} hitSlop={8}>
              <Text style={styles.switchLink}>Sign in with a password instead</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <Field
              label="Phone number or email"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="username"
              placeholder="9876500011"
              editable={!busy}
            />
            <Text style={styles.hint}>{passwordHint}</Text>

            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholder="••••••••"
              editable={!busy}
              onSubmitEditing={submitPassword}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label="Sign in"
              onPress={submitPassword}
              loading={busy}
              disabled={!trimmedIdentifier || !password}
            />

            <Text style={styles.footnote}>
              For accounts set up before RoadMate Rider used codes. If you registered yourself,
              you have no password — go back and use your mobile number.
            </Text>

            <Pressable onPress={() => { setMode('otp'); setError(null); }} hitSlop={8}>
              <Text style={styles.switchLink}>Use my mobile number instead</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * The two outcomes that are neither a session nor a form: an application waiting
 * for a decision, and an account that was switched off.
 *
 * Both say what the rider can actually *do* next, because neither has an action
 * inside this app — and "pending" with no further sentence is what generates the
 * support call this screen exists to prevent.
 */
function ApplicationStatus({ outcome, onBack }) {
  const pending = outcome.outcome === 'PENDING';
  const app = outcome.application ?? {};

  return (
    <View style={styles.form}>
      <Banner
        tone={pending ? 'warning' : 'danger'}
        message={
          pending
            ? 'Your application is with RoadMate and has not been decided yet.'
            : 'This account is not active.'
        }
      />

      {pending ? (
        <Card style={styles.statusCard}>
          <Text style={typography.cardTitle}>{app.name ?? 'Your application'}</Text>
          <KeyValue label="Sent" value={fmtDate(app.appliedAt)} />
          <KeyValue label="Area" value={app.regionName || app.districtName || '—'} />
          <KeyValue label="Vehicle" value={app.vehicleType ?? '—'} />
          <Text style={styles.statusNote}>
            The RoadMate partner for {app.districtName || 'your district'} reviews new delivery
            partners. Check back here with your number and a new code — you will be signed straight
            in once you are approved.
          </Text>
        </Card>
      ) : (
        <Card style={styles.statusCard}>
          <Text style={styles.statusNote}>
            {outcome.employerShop
              ? `${outcome.employerShop.name} has taken you off its delivery staff, so you cannot sign in. If that is a mistake, ask the shop to add you back from their RoadMate Shop app.`
              : 'Your delivery partner account has been switched off. Please contact your RoadMate regional partner.'}
          </Text>
        </Card>
      )}

      <Button label="Back" variant="ghost" onPress={onBack} />
    </View>
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
  wrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
  form: { gap: spacing.lg },
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

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    gap: spacing.sm
  },
  prefix: { ...typography.body, color: colors.inkMuted, fontWeight: '700' },
  phoneInput: { flex: 1, fontSize: 15, color: colors.ink },

  codeInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 6,
    color: colors.ink
  },

  statusCard: { gap: spacing.xs },
  statusNote: { ...typography.meta, lineHeight: 18, marginTop: spacing.sm },

  hint: { ...typography.meta, marginTop: -spacing.md },
  resend: { ...typography.meta, textAlign: 'center', fontWeight: '700', color: colors.info },
  resendOff: { color: colors.inkFaint },
  switchLink: { ...typography.meta, textAlign: 'center', fontWeight: '700', color: colors.info },
  error: { ...typography.meta, color: colors.danger },
  footnote: { ...typography.meta, textAlign: 'center', lineHeight: 18 }
});
