// Staff sign-in. **Two doors onto one account** (2026-08-12):
//
//   1. phone number **or** email address, plus a password — the same
//      credentials as the web dashboards;
//   2. phone number plus an OTP, no password at all.
//
// Both, not either. The seven dashboards have no OTP screen, so the password
// cannot go; and a shop owner who has forgotten a password issued to them by a
// regional partner had, before door 2, no way back in that did not involve an
// admin overwriting it. See `authController.requestStaffOtp` for the full
// reasoning, including why this must not become OTP-only.
//
// Resolved with the client on 2026-08-07: shops can sign in with a phone number
// **as well as** an email address, not instead of one. So this is one field that
// takes either, rather than a toggle — a shop owner should not have to know
// which kind of credential they have before they can start typing, and the
// server can tell the two apart perfectly well by looking (`src/lib/phone.js`).
//
// The keyboard is the one real design decision here. It defaults to the phone
// pad, because the phone number is what a shop owner knows by heart and the
// email address is the thing they have to go and find — but the pad still
// carries letters, so an email address is typeable without switching modes.
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet
} from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, radius, typography, Button, BrandMark } from '@roadmate/ui';
import { useSession } from '../src/session.js';
import { VARIANT } from '../src/variant.js';

/** Mirrors `looksLikePhone` on the server — for the hint text only. */
const looksLikePhone = (raw) => /^[+\d][\d\s\-()]*$/.test(raw.trim());

/** Mirrors `normalizePhone`'s acceptance, for enabling a button. */
const isMobile = (raw) => /^(\+91|91|0)?[6-9]\d{9}$/.test(String(raw).replace(/[\s\-()]/g, ''));

export default function SignIn() {
  const { signIn, requestOtp, signInWithOtp, isSignedIn, loading: restoring } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The second door (2026-08-12). `mode` is which door is showing; within the
  // OTP door, having sent a code is what moves it from "which number" to "what
  // was the code" — one flag, because they are the same two questions in order.
  //
  // ⚠️ Every hook on this screen stays **above** the `isSignedIn` redirect
  // below. Hooks after an early return is precisely what crashed this screen on
  // a successful sign-in once already (2026-08-11); adding a door is exactly the
  // kind of change that reintroduces it.
  const [mode, setMode] = useState('password');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  // The number the code actually went to, kept separate from the field so that
  // editing the box after sending cannot verify against a different number.
  const [sentTo, setSentTo] = useState(null);
  // Only ever set when the server echoes it — see `lib/otp.js`. While the
  // client's DLT subscription is lapsed, this is the only way the code arrives.
  const [devCode, setDevCode] = useState(null);

  const trimmed = identifier.trim();
  // Purely advisory: the server is the authority on what a valid identifier is,
  // and it deliberately gives the same answer for every kind of failure so a
  // stranger cannot enumerate who is on the platform. This only tells someone
  // mid-typing which of the two things the app thinks they are entering.
  const hint = useMemo(() => {
    if (!trimmed) return 'Whichever you registered with.';
    if (looksLikePhone(trimmed)) {
      return /^(\+91|91|0)?[6-9]\d{9}$/.test(trimmed.replace(/[\s\-()]/g, ''))
        ? 'Signing in with your phone number.'
        : 'That does not look like a 10-digit mobile number yet.';
    }
    return 'Signing in with your email address.';
  }, [trimmed]);

  if (!restoring && isSignedIn) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(trimmed, password);
      // No navigation here: the session flipping to signed-in re-renders the
      // redirect above, so there is one route decision and not two.
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError(null);
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestOtp(phone.trim());
      setSentTo(phone.trim());
      setCode('');
      setDevCode(result?.code ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      // `sentTo`, never the live field — see the note where it is declared.
      await signInWithOtp(sentTo, code.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        {/* The client's actual mark, shared from `@roadmate/ui` (2026-08-11).
            This was a 56 dp yellow square — a placeholder for a logo the Customer
            app had been showing all along. Two of the three apps opened on an
            unbranded swatch, which is the first thing anybody sees.
            The name is still from the build, not hardcoded: this screen is the
            first chance to tell someone they downloaded the wrong one of the two. */}
        <BrandMark title={VARIANT.name} tagline={VARIANT.tagline} />

        {mode === 'password' ? (
          <View style={styles.form}>
            <Field
              label="Phone number or email"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              // `email-address` rather than `phone-pad`: it carries digits *and*
              // letters, so one field genuinely accepts both. A numeric pad would
              // make the email half untypeable.
              keyboardType="email-address"
              autoComplete="username"
              textContentType="username"
              placeholder="9876500011  or  you@yourbusiness.in"
            />
            <Text style={styles.hint}>{hint}</Text>

            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholder="••••••••"
              onSubmitEditing={submit}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button label="Sign in" onPress={submit} loading={busy} disabled={!trimmed || !password} />

            {/* The way back in for an owner who does not know the password —
                this platform has no reset endpoint, so before this door the only
                answer was an admin overwriting it. */}
            <Pressable onPress={() => switchMode('otp')} hitSlop={8}>
              <Text style={styles.link}>Sign in with an OTP instead</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            {!sentTo ? (
              <>
                <Field
                  label="Phone number"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  placeholder="9876500011"
                  onSubmitEditing={sendCode}
                />
                <Text style={styles.hint}>
                  The number registered with your RoadMate account. We will send a 6-digit code.
                </Text>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Button
                  label="Send code"
                  onPress={sendCode}
                  loading={busy}
                  disabled={!isMobile(phone)}
                />
              </>
            ) : (
              <>
                <Field
                  label={`Code sent to ${sentTo}`}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  placeholder="••••••"
                  onSubmitEditing={submitCode}
                />

                {/* Shown only when the server echoed the code, which it does
                    while `OTP_ECHO_CODE` covers the lapsed DLT subscription.
                    Saying so plainly beats a screen that claims an SMS is on its
                    way when no SMS can be sent. */}
                {devCode ? <Text style={styles.hint}>SMS is off in this build. Your code is {devCode}.</Text> : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Button
                  label="Sign in"
                  onPress={submitCode}
                  loading={busy}
                  disabled={code.trim().length < 4}
                />

                <Pressable
                  onPress={() => {
                    setSentTo(null);
                    setDevCode(null);
                    setError(null);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.link}>Use a different number</Text>
                </Pressable>
              </>
            )}

            <Pressable onPress={() => switchMode('password')} hitSlop={8}>
              <Text style={styles.link}>Sign in with a password instead</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
  hint: { ...typography.meta, marginTop: -spacing.md },
  error: { ...typography.meta, color: colors.danger },
  link: { ...typography.meta, color: colors.ink, fontWeight: '700', textAlign: 'center' }
});
