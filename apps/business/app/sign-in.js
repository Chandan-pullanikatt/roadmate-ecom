// Staff sign-in — phone number **or** email address, plus a password. The same
// credentials as the web dashboards.
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
import { View, Text, TextInput, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, radius, typography, Button, BrandMark } from '@roadmate/ui';
import { useSession } from '../src/session.js';
import { VARIANT } from '../src/variant.js';

/** Mirrors `looksLikePhone` on the server — for the hint text only. */
const looksLikePhone = (raw) => /^[+\d][\d\s\-()]*$/.test(raw.trim());

export default function SignIn() {
  const { signIn, isSignedIn, loading: restoring } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
  error: { ...typography.meta, color: colors.danger }
});
