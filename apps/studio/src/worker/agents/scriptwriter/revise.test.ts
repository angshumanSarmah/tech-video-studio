import { planOfSpec, type BeatScript } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { FIXTURE_WORDS_PER_SEC } from '../fixture-topics.ts';
import { fixtureGeneratedSpec, recordedNotes, recordedScript } from '../generator/testing.ts';
import type { ScriptwriterCheckDeps } from './check.ts';
import {
  REVISE_VISUAL_RULE,
  reviseCheck,
  reviseUserMessage,
  spliceRevision,
  type ReviseRequest,
} from './revise.ts';

const spec = fixtureGeneratedSpec('rate-limiter');
const script: BeatScript[] = spec.script;
const deps: ScriptwriterCheckDeps = {
  plan: planOfSpec(spec),
  notes: recordedNotes('rate-limiter'),
  topicTitle: 'Rate limiters',
  level: 'beginner',
  wordsPerSec: FIXTURE_WORDS_PER_SEC,
  pauses: { beatGapSec: 0, landingSec: 0 },
  spec: { id: spec.meta.id, series: spec.meta.series, formatOverride: spec.meta.format },
  hud: { seriesLabel: 'SYSTEM DESIGN', channelHandle: null },
};
const req: ReviseRequest = {
  beatId: 'beat1',
  fields: ['narration'],
  issues: [{ code: 'beat_over_target', message: '<example-message>' }],
};
const recorded = recordedScript('rate-limiter').script[0]!;
const trimmed = recorded.narration.replace('In March twenty twenty-five, Larkspur', 'Larkspur');
const codes = (value: unknown) =>
  reviseCheck(deps, script, req)(value).map((i) => `${i.path} ${i.code}`);

describe('reviseCheck', () => {
  it('passes a revision of the allowed field that every Scriptwriter check accepts', () => {
    expect(codes({ script: [{ ...recorded, narration: trimmed }] })).toEqual([]);
  });

  it('rejects a change outside the allowed fields (repair_scope)', () => {
    const retagged = {
      ...recorded,
      narration: trimmed,
      tags: ['checkout down', 'too much traffic'],
    };
    expect(codes({ script: [retagged] })).toEqual(['$.script[0].tags repair_scope']);
  });

  it("runs the Scriptwriter's checks on the beat, with paths into the one-beat answer", () => {
    const digits = { ...recorded, narration: `${trimmed} It lasted 47 minutes.` };
    expect(codes({ script: [digits] })).toContain('$.script[0].narration digits_in_narration');
  });

  it('marks narration that describes the picture advisory (soft): never a repair turn', () => {
    const visual = { ...recorded, narration: trimmed.replace(/\.$/, ', shown in red.') };
    const issues = reviseCheck(deps, script, req)({ script: [visual] });
    expect(issues).toEqual([
      expect.objectContaining({
        path: '$.script[0].narration',
        code: 'narration_describes_visuals',
        soft: true,
      }),
    ]);
  });

  it('wants exactly the one beat back', () => {
    expect(codes({ script: [recorded, recordedScript('rate-limiter').script[1]] })).toEqual([
      '$.script revise_one_beat',
    ]);
  });
});

describe('spliceRevision', () => {
  it('takes only the allowed fields and keeps the headline anchor', () => {
    const withAnchor = script.map((b, i) =>
      i === 0 && b.headline
        ? { ...b, headline: { ...b.headline, at: { type: 'word' as const, index: 3 } } }
        : b,
    );
    const spliced = spliceRevision(
      withAnchor,
      { ...req, fields: ['narration', 'headline'] },
      {
        ...recorded,
        narration: trimmed,
        headline: { text: 'Rate limiter = the request gate', semantic: 'concept' },
        tags: ['ignored'],
      },
    );
    expect(spliced[0]?.narration).toBe(trimmed);
    expect(spliced[0]?.headline).toEqual({
      text: 'Rate limiter = the request gate',
      semantic: 'concept',
      at: { type: 'word', index: 3 },
    });
    expect(spliced[0]?.tags).toEqual(script[0]?.tags);
    expect(spliced.slice(1)).toEqual(script.slice(1));
  });
});

describe('reviseUserMessage', () => {
  it('tells the Scriptwriter to keep the narration for a note about the picture', () => {
    const base = {
      topic: { title: 'Rate limiters', notes: null },
      series: { name: 'System Design' },
      level: 'beginner' as const,
      format: spec.meta.format,
      plan: deps.plan,
      notes: deps.notes,
      research: { sources: [], chunks: [], budget: 0, leftOut: [] } as never,
      budgets: [],
    };
    const message = reviseUserMessage(base, script, req, undefined);
    expect(message).toContain(`## REVISE beat beat1`);
    expect(message).toContain(REVISE_VISUAL_RULE);
    expect(REVISE_VISUAL_RULE).toMatch(/^When FEEDBACK is only about what is drawn/);
  });
});
