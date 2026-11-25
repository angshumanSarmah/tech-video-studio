import { describe, expect, it } from 'vitest';
import { settingsChanges } from './run-settings.ts';

describe('settingsChanges', () => {
  it('lists each leaf that differs, in key order, with unset for a missing one', () => {
    expect(
      settingsChanges(
        'snapshot',
        { llm: { models: { scriptwriter: 'a', director: 'd' } }, budget: { maxRunUsd: 0.75 } },
        { llm: { models: { scriptwriter: 'b', director: 'd' } }, video: { maxParts: 2 } },
      ),
    ).toEqual([
      'snapshot.budget.maxRunUsd: 0.75 → unset',
      'snapshot.llm.models.scriptwriter: "a" → "b"',
      'snapshot.video.maxParts: unset → 2',
    ]);
  });

  it('compares arrays whole and finds nothing in equal settings', () => {
    expect(settingsChanges('s', { a: [1, 2] }, { a: [1, 3] })).toEqual(['s.a: [1,2] → [1,3]']);
    expect(settingsChanges('s', { a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
  });
});
