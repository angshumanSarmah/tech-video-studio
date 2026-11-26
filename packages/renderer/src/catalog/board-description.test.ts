import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { getTheme } from '../theme/index.ts';
import { describeBoard } from './board-description.ts';
import { DEFAULT_REGISTRIES } from './registries.ts';
import { fixtureSpec } from './test-specs.ts';

type Json = Record<string, unknown>;

describe('describeBoard: refs name their target', () => {
  it('an icon by its asset, a card by its text (run 1 b2: a tag pinned to the disk icon)', () => {
    const input = fixtureSpec();
    const scene = input.scenes[0] as Json & { elements: Json[] };
    scene.elements.push(
      { id: 'icon-disk', primitive: 'icon', props: { asset: 'database', semantic: 'problem' } },
      {
        id: 'tag-ram',
        primitive: 'tag',
        props: { text: 'RAM not disk', pin: { to: 'icon-disk', side: 'top' } },
      },
      {
        id: 'tag-api',
        primitive: 'tag',
        props: { text: 'one call', pin: { to: 'api', side: 'bottom' } },
      },
    );
    const spec = parseRenderableSpec(input);
    const board = describeBoard(spec, spec.scenes[0]!.beatId, {
      registries: DEFAULT_REGISTRIES,
      theme: getTheme(),
    });
    const refs = (id: string) => board.items.find((i) => i.id === id)?.refs;
    expect(refs('tag-ram')).toEqual([
      { key: 'pin.to', id: 'icon-disk', side: 'top', name: 'icon database' },
    ]);
    expect(refs('tag-api')?.[0]?.name).toMatch(/^node_card "/);
  });
});
