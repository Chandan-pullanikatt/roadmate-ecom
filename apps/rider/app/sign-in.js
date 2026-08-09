// Rider sign-in — phone number **or** email address, plus a password.
//
// The same door and the same staff JWT as the Business app, with one difference
// that is worth the duplication: **the hint leads with the phone number**. A
// shop owner registered a business and probably has an email address on file; a
// delivery partner was onboarded by a field executive with a phone number, and a
// shop's own delivery boy was added from the Shop app's roster — which takes a
// name, a phone number and a password, and no email address at all. For most
// people signing in here, the phone number is the *only* credential that exists.
//
// The keyboard is still `email-address` rather than the phone pad, because it
// carries digits and letters both, so one field genuinely accepts either.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, radius, typography, Button } from '@roadmate/ui';
import { useSession } from '../src/session.js';

/** Mirrors `looksLikePhone` on the server — for the hint text only. */
const looksLikePhone = (raw) => /^[+\d][\d\s\-()]*$/.test(raw.trim());

export default function SignIn() {
  const { signIn, isSignedIn, loading: restoring } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const trimmed = identifier.trim();
  // Purely advisory. The server gives the same answer for every kind of failure
  // so a stranger cannot enumerate who is on the platform; this only tells
  // somebody mid-typing which of the two the app thinks they are entering.
  const hint = useMemo(() => {
    if (!trimmed) return 'Whichever your RoadMate contact registered for you.';
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

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.mark} />
          <Text style={styles.title}>RoadMate Rider</Text>
          <Text style={typography.meta}>For delivery partners</Text>
        </View>

        <View style={styles.form}>
          <Field
            label="Phone number or email"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="username"
            textContentType="username"
            placeholder="9876500011"
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

          {/* There is no self-signup. A delivery partner is onboarded by a
              field executive; a shop's own delivery boy is added by his shop
              from the Shop app. Saying so is kinder than a "Register" button
              that would have nothing behind it. */}
          <Text style={styles.footnote}>
            No account? RoadMate delivery partners are set up by your regional contact. If you deliver
            for a shop, ask the shop to add you from their RoadMate Shop app.
          </Text>
        </View>
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
  brand: { alignItems: 'center', gap: spacing.xs },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    marginBottom: spacing.md
  },
  title: { ...typography.screenTitle },
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
  footnote: { ...typography.meta, textAlign: 'center', lineHeight: 18 }
});
