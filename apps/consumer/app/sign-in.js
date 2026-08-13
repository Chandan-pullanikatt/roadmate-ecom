// Phone number, then a code. There is no password on this screen because there
// is no password column on `Customer`.
//
// Three things this screen has to get right, all of them about failure:
//
//   • **Every wrong answer looks the same.** The server returns the same
//     "Invalid or expired OTP" whether the code was wrong, expired or never
//     existed, so that a stranger cannot enumerate who is on the platform. This
//     screen must not "helpfully" distinguish them either.
//   • **A 429 is two different things.** Five code *requests* in ten minutes is
//     one limit; five wrong *guesses* is another, and the second one burns the
//     code so that even the right one stops working. They are told apart by
//     which step raised them, and the wording differs because the fix differs:
//     wait, versus ask for a new code.
//   • **The development code is shown, and labelled.** MSG91 is coded and
//     stubbed until the client's credentials land (PLAN §6), so outside
//     production the API returns the code in the response body. Printing it
//     here is what makes the app testable on a real phone today; a server test
//     pins that production never sends it, so this box cannot appear there.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  StyleSheet
} from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, radius, typography, Button, Banner } from '@roadmate/ui';
import { useSession } from '../src/session.js';
import { LOGO } from '../src/art.js';

/** Mirrors `normalizePhone` on the server, for the button's enabled state only. */
const isPhone = (raw) => /^[6-9]\d{9}$/.test(String(raw).replace(/\D/g, '').slice(-10));

export default function SignIn() {
  const { requestOtp, verifyOtp, isSignedIn, loading: restoring } = useSession();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [devCode, setDevCode] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const codeInput = useRef(null);

  // The countdown is only about *this* screen's resend button. The code's real
  // life is 5 minutes and the server is the authority on both; this stops a
  // customer tapping "Resend" four times in ten seconds and spending their five
  // requests before the first SMS has arrived.
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  if (!restoring && isSignedIn) return <Redirect href="/" />;

  const digits = phone.replace(/\D/g, '').slice(-10);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestOtp(digits);
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
      await verifyOtp(digits, code.trim());
      // No navigation: the session flipping to signed-in re-renders the redirect
      // above, so there is one route decision rather than two.
    } catch (err) {
      setError(
        err.status === 429
          ? 'That code has been locked after too many wrong attempts. Ask for a new one.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        {/* The real logo (2026-08-10). This was a plain yellow square standing in
            for a mark nobody had supplied; the client's artwork lives in
            `client/public/roadmatelogo.jpeg` and is now bundled here too, so the
            first screen of the app is the client's brand rather than a swatch.
            The launcher icon is the same mark as of 2026-08-13 (`assets/icon.png`,
            drawn as outlines rather than upscaled), so the icon a customer taps
            and the logo they land on are finally the same artwork. */}
        <View style={styles.brand}>
          <Image source={LOGO} style={styles.mark} resizeMode="cover" />
          <Text style={styles.title}>RoadMate</Text>
          <Text style={typography.meta}>Everything near you, delivered</Text>
        </View>

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
                  // Editing the number invalidates the code that was sent to the
                  // old one. Going back to step one is the honest thing to do.
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

              <Button label="Sign in" onPress={verify} loading={busy} disabled={code.trim().length < 4} />

              <Pressable onPress={send} disabled={busy || secondsLeft > 0} hitSlop={8}>
                <Text style={[styles.resend, (busy || secondsLeft > 0) && styles.resendOff]}>
                  {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
                </Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.footnote}>
            We only use your number to sign you in and to let your delivery partner reach you.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  wrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
  brand: { alignItems: 'center', gap: spacing.xs },
  // The logo is a 16:9 photograph, so it is framed rather than cropped to a
  // circle: a square crop of a wordmark cuts the word in half.
  mark: { width: 168, height: 94, borderRadius: radius.lg, marginBottom: spacing.md },
  title: { ...typography.screenTitle },
  form: { gap: spacing.lg },
  field: { gap: spacing.xs },

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

  resend: { ...typography.meta, textAlign: 'center', fontWeight: '700', color: colors.info },
  resendOff: { color: colors.inkFaint },
  error: { ...typography.meta, color: colors.danger },
  footnote: { ...typography.meta, textAlign: 'center', lineHeight: 18 }
});
