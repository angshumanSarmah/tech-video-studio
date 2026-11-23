import { describe, expect, it } from 'vitest';
import { validateVideoSpec } from '../spec/validate.ts';
import { DirectorPlanSchema, type DirectorPlan } from './plan.ts';
import { assembleScriptedSpec, specFromPlan } from './spec.ts';

function plan(): DirectorPlan {
  return DirectorPlanSchema.parse({
    meta: {
      title: 'Why queues shed load',
      topicClass: 'concept',
      format: 'full',
      targetLengthSec: 45,
    },
    story: {
      devices: ['failure_before_fix'],
      chapters: [{ id: 'burst', title: 'The burst' }],
      beats: [
        { id: 'hook', chapterId: 'burst', intent: 'A burst hits', targetSec: 20 },
        { id: 'shed', chapterId: 'burst', intent: 'A full queue sheds', targetSec: 25 },
      ],
      ending: { kind: 'callback_ending', cta: '<example-share-line>' },
    },
  });
}

const ctx = { id: 'queues', series: 'system-design', seriesNumber: 7 };
const script = [
  { beatId: 'hook', narration: 'A burst of requests hits one server at once.' },
  { beatId: 'shed', narration: 'A full queue turns the extra requests away.', tags: ['SHED'] },
];

describe('assembleScriptedSpec', () => {
  it('is the plan as a spec plus the script, valid before TTS', () => {
    const spec = assembleScriptedSpec(plan(), script, ctx);
    expect(spec).toEqual({ ...specFromPlan(plan(), ctx), script });
    expect(spec.story.ending.seriesNumber).toBe(7);
    const result = validateVideoSpec(spec);
    expect(result.errors).toEqual([]);
    expect(result.spec?.script?.[1]?.tags).toEqual(['SHED']);
  });

  it('leaves coverage to validation: a script missing a beat is reported there', () => {
    const result = validateVideoSpec(assembleScriptedSpec(plan(), script.slice(0, 1), ctx));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('missing_beat');
  });

  it('copies the script, so later edits to the input do not reach the spec', () => {
    const input = [...script];
    const spec = assembleScriptedSpec(plan(), input, ctx);
    input.pop();
    expect(spec.script).toHaveLength(2);
  });
});
