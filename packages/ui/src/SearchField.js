// The designed search field (`designs/Partner.png`, screens 2 and 3): a
// magnifier glyph, the input, and a trailing affordance.
//
// This exists because three screens had each hand-rolled the same bare
// `TextInput` with the same eleven-line style block and none of them had the
// magnifier the design shows. A search box with no icon reads as a text field,
// which is the one thing it is not.
//
// The trailing slot is a **clear** button rather than the design's filter glyph:
// none of these lists has a filter sheet behind it, and an icon that does
// nothing is worse than no icon. `onFilter` is there for when one does.
import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from './tokens.js';

export function SearchField({ value, onChangeText, placeholder, onSubmit, onFilter, autoFocus }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.glyph}>⌕</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        autoCorrect={false}
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Text style={styles.clear}>✕</Text>
        </Pressable>
      ) : onFilter ? (
        <Pressable onPress={onFilter} hitSlop={10} accessibilityRole="button" accessibilityLabel="Filter">
          <Text style={styles.glyph}>⇅</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 46
  },
  glyph: { fontSize: 17, color: colors.inkFaint },
  clear: { fontSize: 13, color: colors.inkFaint, fontWeight: '700' },
  input: { flex: 1, ...typography.body, paddingVertical: spacing.sm }
});
