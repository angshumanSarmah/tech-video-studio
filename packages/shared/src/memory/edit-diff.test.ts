import { describe, expect, it } from 'vitest';
import { editDiff } from './edit-diff.ts';

describe('editDiff', () => {
  it('lists changed, added and removed leaves by path, in document order', () => {
    const before = { script: [{ headline: { text: 'A long headline' }, tags: ['x', 'y'] }] };
    const after = { script: [{ headline: { text: 'Short', semantic: 'focus' }, tags: ['x'] }] };
    expect(editDiff(before, after)).toEqual({
      changes: [
        { path: '$.script[0].headline.text', before: '"A long headline"', after: '"Short"' },
        { path: '$.script[0].headline.semantic', after: '"focus"' },
        { path: '$.script[0].tags[1]', before: '"y"' },
      ],
      omitted: 0,
    });
  });

  it('lists each leaf of a subtree added whole', () => {
    expect(editDiff({ a: 1 }, { a: 1, b: { c: [true] } }).changes).toEqual([
      { path: '$.b.c[0]', after: 'true' },
    ]);
  });

  it('is empty for equal values and caps long ones', () => {
    expect(editDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual({
      changes: [],
      omitted: 0,
    });
    const many = editDiff(
      Array.from({ length: 30 }, (_, i) => i),
      Array.from({ length: 30 }, (_, i) => i + 1),
      { maxChanges: 5, maxValueChars: 3 },
    );
    expect(many.changes).toHaveLength(5);
    expect(many.omitted).toBe(25);
    expect(editDiff('x'.repeat(10), 'y', { maxValueChars: 5 }).changes[0]?.before).toBe('"xxx…');
  });
});
