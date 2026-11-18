/**
 * Typing reveals at fixed rates that never depend on beat length: a data block types one field
 * every `FIELD_SEC`; a command types at `COMMAND_CHARS_PER_SEC`, sped up so it never takes longer
 * than `COMMAND_MAX_SEC`.
 */

export const FIELD_SEC = 0.35;
export const COMMAND_CHARS_PER_SEC = 30;
export const COMMAND_MAX_SEC = 1.5;

/**
 * Characters visible on each line `typingSec` seconds after typing began; line `i` types during
 * its own `FIELD_SEC` slot. `undefined` (no enter event) shows every line in full.
 */
export function typedFieldChars(
  lineLengths: readonly number[],
  typingSec: number | undefined,
): number[] {
  if (typingSec === undefined) return [...lineLengths];
  return lineLengths.map((length, i) => {
    const t = (typingSec - i * FIELD_SEC) / FIELD_SEC;
    return Math.round(length * Math.min(1, Math.max(0, t)));
  });
}

/** Seconds a data block takes to type `fieldCount` fields. */
export function fieldTypingSec(fieldCount: number): number {
  return fieldCount * FIELD_SEC;
}

/** Characters of a command visible `typingSec` seconds after typing began. */
export function typedCommandChars(length: number, typingSec: number | undefined): number {
  if (typingSec === undefined) return length;
  const rate = Math.max(COMMAND_CHARS_PER_SEC, length / COMMAND_MAX_SEC);
  return Math.min(length, Math.floor(typingSec * rate + 1e-9));
}
