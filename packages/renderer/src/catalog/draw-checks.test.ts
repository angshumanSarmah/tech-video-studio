import { validateVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs } from '../../fixtures/index.ts';
import { getTheme } from '../theme/index.ts';
import { drawCutShortWarnings } from './draw-checks.ts';
import { DEFAULT_REGISTRIES } from './registries.ts';
import { fixtureSpec } from './test-specs.ts';

type Json = Record<string, unknown>;
const note = { id: 'note', primitive: 'node_card', props: { title: 'Late arrival' } };
const word = (text: string) => ({ type: 'word_text', text });
/** Seconds before the beat's narration ends (the scene shows 0.15 s longer, to the next beat). */
const beforeEnd = (offsetSec: number) => ({ type: 'beat', edge: 'end', offsetSec: -offsetSec });

/** The rate-limiter fixture with `note` added to scene `index` and these events on it. */
function withNote(index: number, events: Json[]) {
  const input = fixtureSpec();
  const scene = input.scenes[index] as Json & { elements: Json[]; events: Json[] };
  scene.elements.push(note);
  scene.events.push(...events);
  const result = validateVideoSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return drawCutShortWarnings(result.spec, DEFAULT_REGISTRIES);
}

describe('draw_cut_short', () => {
  it('warns when an enter near the end cannot finish before the scene changes', () => {
    // The next beat after bucket-empty starts a new board; a draw takes at least 0.5 s.
    const warnings = withNote(2, [{ at: beforeEnd(0.1), action: 'enter', targets: ['note'] }]);
    expect(warnings.map((w) => [w.path, w.code])).toEqual([
      ['$.scenes[2].events[4]', 'draw_cut_short'],
    ]);
    expect(warnings[0]?.message).toMatch(/"note" enters at .* cut off \d\.\d\ds early/);
  });

  it('accepts an enter with time to finish', () => {
    expect(withNote(2, [{ at: word('client'), action: 'enter', targets: ['note'] }])).toEqual([]);
  });

  it('accepts a late enter when the next beat continues the chain with it still present', () => {
    // hook ends on "morning." and bucket-intro continues it.
    const late = { at: word('morning'), action: 'enter', targets: ['note'] };
    expect(withNote(0, [late])).toEqual([]);
    const gone = {
      at: { type: 'beat', edge: 'end', offsetSec: 0 },
      action: 'exit',
      targets: ['note'],
    };
    expect(withNote(0, [late, gone]).map((w) => w.code)).toEqual(['draw_cut_short']);
  });

  it('measures in the render theme: a fade theme’s 0.45 s enter fits where the draw does not', () => {
    const input = fixtureSpec();
    const scene = input.scenes[2] as Json & { elements: Json[]; events: Json[] };
    scene.elements.push(note);
    // 0.32 s before the end + 0.15 s gap: a 0.45 s fade fits, a 0.5 s draw does not.
    scene.events.push({ at: beforeEnd(0.32), action: 'enter', targets: ['note'] });
    const result = validateVideoSpec(input);
    if (!result.ok) throw new Error('invalid');
    const paper = drawCutShortWarnings(result.spec, DEFAULT_REGISTRIES, getTheme('drafting-paper'));
    expect(paper).toHaveLength(1);
    const dark = drawCutShortWarnings(result.spec, DEFAULT_REGISTRIES, getTheme('blueprint-dark'));
    expect(dark).toEqual([]);
  });

  it.each(allFixtureSpecs.map((s) => [s.meta.id, s] as const))('%s has none', (_id, spec) => {
    expect(drawCutShortWarnings(spec, DEFAULT_REGISTRIES)).toEqual([]);
  });
});
