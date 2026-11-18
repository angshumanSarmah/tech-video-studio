import { describe, expect, it } from 'vitest';
import {
  COMMAND_MAX_SEC,
  FIELD_SEC,
  fieldTypingSec,
  typedCommandChars,
  typedFieldChars,
} from './typing.ts';

describe('typedFieldChars', () => {
  it('shows every field in full without an enter event', () => {
    expect(typedFieldChars([10, 20], undefined)).toEqual([10, 20]);
  });

  it('types one field per slot, in order', () => {
    expect(typedFieldChars([10, 20, 30], 0)).toEqual([0, 0, 0]);
    expect(typedFieldChars([10, 20, 30], FIELD_SEC / 2)).toEqual([5, 0, 0]);
    expect(typedFieldChars([10, 20, 30], FIELD_SEC * 1.5)).toEqual([10, 10, 0]);
    expect(typedFieldChars([10, 20, 30], fieldTypingSec(3))).toEqual([10, 20, 30]);
  });

  it('takes a fixed time per field, whatever the line length', () => {
    expect(typedFieldChars([4, 400], FIELD_SEC * 2)).toEqual([4, 400]);
  });
});

describe('typedCommandChars', () => {
  it('shows the whole command without an enter event', () => {
    expect(typedCommandChars(17, undefined)).toBe(17);
  });

  it('types about 30 characters a second', () => {
    expect(typedCommandChars(20, 0)).toBe(0);
    expect(typedCommandChars(20, 0.5)).toBe(15);
    expect(typedCommandChars(20, 1)).toBe(20);
  });

  it('speeds up so a long command never takes longer than the cap', () => {
    expect(typedCommandChars(48, COMMAND_MAX_SEC)).toBe(48);
    expect(typedCommandChars(48, COMMAND_MAX_SEC / 2)).toBe(24);
  });
});
