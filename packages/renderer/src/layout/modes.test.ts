import { BeatSceneSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  beatLayoutMode,
  DEFAULT_LAYOUT_MODE,
  patternLayoutModes,
  type PatternLayouts,
} from './modes.ts';

const patterns: PatternLayouts = new Map([
  ['flow', { layoutMode: 'pipeline' }],
  ['near', { layoutMode: 'near_far' }],
]);

function scene(extra: Record<string, unknown>) {
  return BeatSceneSchema.parse({ beatId: 'b', kind: 'board', ...extra });
}

const instance = (id: string, pattern: string) => ({ id, pattern, params: {} });

describe('beatLayoutMode', () => {
  it('uses the default for a beat without patterns or a mode', () => {
    expect(beatLayoutMode(scene({}), patterns)).toBe(DEFAULT_LAYOUT_MODE);
  });

  it("defaults to the first pattern's mode", () => {
    const s = scene({ patterns: [instance('a', 'near'), instance('b', 'flow')] });
    expect(beatLayoutMode(s, patterns)).toBe('near_far');
  });

  it("lets the scene's own mode override its patterns", () => {
    const s = scene({ layoutMode: 'two_column', patterns: [instance('a', 'flow')] });
    expect(beatLayoutMode(s, patterns)).toBe('two_column');
  });

  it('skips unknown patterns', () => {
    const s = scene({ patterns: [instance('a', 'ghost'), instance('b', 'flow')] });
    expect(beatLayoutMode(s, patterns)).toBe('pipeline');
  });
});

describe('patternLayoutModes', () => {
  it('lists each distinct mode once, in pattern order', () => {
    const s = scene({
      patterns: [instance('a', 'flow'), instance('b', 'near'), instance('c', 'flow')],
    });
    expect(patternLayoutModes(s, patterns)).toEqual(['pipeline', 'near_far']);
  });
});
