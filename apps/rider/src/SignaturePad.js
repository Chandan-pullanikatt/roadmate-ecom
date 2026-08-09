// A place for a customer to sign with their finger.
//
// **No new native dependency, deliberately.** The obvious implementations —
// `react-native-svg` to draw and `react-native-view-shot` to rasterise — would
// add two native modules to all six builds, and a development build to test
// them, to produce a blurry PNG of information the app already holds as
// coordinates. Instead the strokes are captured as points, drawn back as plain
// Views while the finger is down, and uploaded as an **SVG** built from those
// same points (`signatureToDataUri` in `@roadmate/api`). A few kilobytes, sharp
// at any size, and nothing to install.
//
// Points are sampled at a minimum distance apart, which is what keeps a
// signature at a couple of hundred segments rather than a couple of thousand —
// riders are on cheap Android phones and this is drawn on the UI thread.
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, Button } from '@roadmate/ui';

const MIN_STEP_PX = 2.5;
const PAD_HEIGHT = 200;

export default function SignaturePad({ onDone, onCancel, busy }) {
  const [strokes, setStrokes] = useState([]);
  const [size, setSize] = useState({ width: 0, height: PAD_HEIGHT });
  const current = useRef([]);

  const push = (x, y) => {
    const points = current.current;
    const last = points[points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_STEP_PX) return;
    points.push({ x, y });
    // A new array each time so React re-renders the in-progress stroke; the
    // finished ones are untouched references and do not re-render.
    setStrokes((prev) => {
      const next = prev.slice();
      next[next.length - 1] = points.slice();
      return next;
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          current.current = [];
          setStrokes((prev) => [...prev, []]);
          push(event.nativeEvent.locationX, event.nativeEvent.locationY);
        },
        onPanResponderMove: (event) => push(event.nativeEvent.locationX, event.nativeEvent.locationY),
        onPanResponderRelease: () => {
          current.current = [];
        }
      }),
    []
  );

  const hasInk = strokes.some((s) => s.length > 1);

  return (
    <View style={styles.wrap}>
      <Text style={typography.sectionTitle}>Customer signature</Text>
      <Text style={typography.meta}>Ask the customer to sign in the box. This is optional.</Text>

      <View
        style={styles.pad}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
        {...responder.panHandlers}
      >
        {strokes.map((points, s) =>
          points.map((point, i) => {
            if (i === 0) return null;
            const prev = points[i - 1];
            const dx = point.x - prev.x;
            const dy = point.y - prev.y;
            const length = Math.hypot(dx, dy);
            return (
              <View
                key={`${s}-${i}`}
                pointerEvents="none"
                style={[
                  styles.segment,
                  {
                    left: prev.x,
                    top: prev.y,
                    width: length + 2,
                    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }]
                  }
                ]}
              />
            );
          })
        )}
        {!hasInk ? <Text style={styles.hint}>Sign here</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button label="Clear" variant="ghost" onPress={() => setStrokes([])} disabled={busy} style={styles.action} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} style={styles.action} />
        <Button
          label="Attach"
          onPress={() => onDone(strokes, size)}
          loading={busy}
          disabled={!hasInk || busy}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  pad: {
    height: PAD_HEIGHT,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    justifyContent: 'center'
  },
  segment: {
    position: 'absolute',
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.ink,
    // Rotate about the segment's start, so it hinges on the previous point.
    transformOrigin: '0px 1.25px'
  },
  hint: { ...typography.meta, textAlign: 'center', color: colors.inkFaint },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 }
});
