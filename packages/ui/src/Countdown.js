// The accept-window countdown.
//
// The server sends `secondsRemaining` as a **duration**, not a deadline, exactly
// so a phone with a wrong clock still counts down correctly (§1.6). This
// component therefore anchors on the device's own monotonic-ish `Date.now()` at
// the moment the value arrived and never compares against `expiresAt`.
//
// It is honest about being an estimate: when it reaches zero it does not decide
// the offer is gone, it calls `onExpire` so the screen can re-ask the server.
// The authority on whether the window closed is the sweeper, and the only proof
// a shop gets is a 409 on accept.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from './tokens.js';

export function Countdown({ seconds, total, onExpire, compact }) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(seconds ?? 0)));
  const expiredRef = useRef(false);

  useEffect(() => {
    // Anchoring on arrival, then deriving from elapsed wall time, keeps the
    // countdown right through a backgrounded app — a 1-second interval that
    // simply decrements loses time whenever the OS stops firing it, which on a
    // 60-second window is the difference between "12s left" and an expired offer.
    const startedAt = Date.now();
    const from = Math.max(0, Math.ceil(seconds ?? 0));
    expiredRef.current = false;
    setRemaining(from);

    const tick = () => {
      const left = Math.max(0, from - Math.floor((Date.now() - startedAt) / 1000));
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };

    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [seconds, onExpire]);

  const window = total || Math.max(seconds ?? 0, 1);
  const fraction = Math.max(0, Math.min(1, remaining / window));
  // Colour is a warning, not decoration: under a third of the window left is
  // where a shop needs to stop reading and start tapping.
  const tone = remaining === 0 ? colors.danger : fraction < 0.34 ? colors.danger : colors.accent;

  return (
    <View style={compact ? styles.compact : styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={typography.meta}>{remaining === 0 ? 'Window closed' : 'Respond within'}</Text>
        <Text style={[styles.value, { color: tone }]}>{formatSeconds(remaining)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

export function formatSeconds(s) {
  const total = Math.max(0, Math.floor(s));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  compact: { gap: 4 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  value: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill }
});
