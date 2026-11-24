import { describe, expect, it } from 'vitest';
import { remapAnchors, wordAlignment } from './remap-anchors.ts';
import { BeatSceneSchema, type BeatScene } from './scene.ts';

const OLD =
  'In March, Larkspur checkout failed for forty-seven minutes. Its rate limiter let them fail.';

function scene(): BeatScene {
  return BeatSceneSchema.parse({
    beatId: 'beat1',
    kind: 'board',
    elements: [
      { id: 'checkout', primitive: 'node_card', props: { title: 'CHECKOUT' } },
      { id: 'limiter', primitive: 'node_card', props: { title: 'RATE LIMITER' } },
    ],
    patterns: [
      {
        id: 'flood',
        pattern: 'flood_then_funnel',
        params: {
          at: { flood: { type: 'word', index: 4 }, funnel: { type: 'beat', edge: 'end' } },
        },
      },
    ],
    events: [
      { at: { type: 'word', index: 3 }, action: 'enter', targets: ['checkout'] },
      {
        at: { type: 'word_text', text: 'limiter', occurrence: 1 },
        action: 'enter',
        targets: ['limiter'],
      },
      { at: { type: 'word', index: 13 }, action: 'reject', targets: ['checkout'] },
    ],
    focus: ['checkout'],
  });
}

describe('wordAlignment', () => {
  it('maps the words a longest common subsequence keeps', () => {
    const map = wordAlignment(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd']);
    expect([...map]).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe('remapAnchors', () => {
  it('moves every anchor to its word when a trim keeps the anchored words', () => {
    const trimmed =
      'Larkspur checkout failed for forty-seven minutes. Its rate limiter let them fail.';
    const result = remapAnchors(scene(), OLD, trimmed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.events.map((e) => e.at)).toEqual([
      { type: 'word', index: 1 },
      { type: 'word_text', text: 'limiter', occurrence: 1 },
      { type: 'word', index: 11 },
    ]);
    const at = result.scene.patterns[0]?.params.at as Record<string, unknown>;
    expect(at.flood).toEqual({ type: 'word', index: 2 });
    expect(at.funnel).toEqual({ type: 'beat', edge: 'end' });
    expect(result.moved).toBe(3);
  });

  it('lists the anchors whose words the edit dropped', () => {
    const rewritten =
      'In March, Larkspur payments broke for forty-seven minutes. Its rate limiter let them fail.';
    expect(remapAnchors(scene(), OLD, rewritten)).toEqual({
      ok: false,
      lost: [
        { path: ['events', 0, 'at'], word: 'checkout' },
        { path: ['patterns', 0, 'params', 'at', 'flood'], word: 'failed' },
      ],
    });
  });

  it('leaves an unchanged narration alone', () => {
    expect(remapAnchors(scene(), OLD, OLD)).toEqual({ ok: true, scene: scene(), moved: 0 });
  });
});
