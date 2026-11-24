import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenStrawberrySpec } from '../../fixtures/index.ts';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { textWidth } from '../fonts/measure-text.ts';
import { beatWorld } from '../scene/beat-world.ts';
import { scriptEdgeTexts } from '../scene/edge-spaces.ts';
import { getTheme, listThemes, TEXT_STYLES } from '../theme/index.ts';
import { showEdgeSpaces, VISIBLE_SPACE } from './common-props.ts';
import { PRIMITIVES } from './registry.ts';

/** The tokenizer fixture's b1 narration (it quotes ' Paris' with its leading space). */
const TOKENIZER_B1 =
  "One support reply says 'Paris'. Why do ' Paris' and 'PARIS' split it differently? A token " +
  'is one piece of text, mapped to one integer.';

describe('showEdgeSpaces', () => {
  it('draws each leading or trailing space as ␣ and keeps inner spaces', () => {
    expect(VISIBLE_SPACE).toBe('␣');
    expect(showEdgeSpaces(' Paris')).toBe('␣Paris');
    expect(showEdgeSpaces('  New York  ')).toBe('␣␣New York␣␣');
    expect(showEdgeSpaces('\tParis\n')).toBe('Paris');
  });
});

describe('scriptEdgeTexts', () => {
  it("collects the narration's quotes and the tags that have an edge space", () => {
    const texts = scriptEdgeTexts({
      beatId: 'b1',
      narration: TOKENIZER_B1,
      tags: ['plain form', 'caps '],
      statCards: [],
    });
    expect([...texts].sort()).toEqual([' Paris', 'caps ']);
  });

  it("never pairs an apostrophe as a quote (the model's tokenizer)", () => {
    const narration = "Corrowby counts with the model's own tokenizer, and ' Paris' stays apart.";
    expect([...scriptEdgeTexts({ beatId: 'b7', narration, tags: [], statCards: [] })]).toEqual([
      ' Paris',
    ]);
  });
});

describe('screen text edge spaces', () => {
  it('trims them in the props schemas (a label, a tag, a data value)', () => {
    const parse = (id: string, props: unknown) =>
      PRIMITIVES.get(id)!.propsSchema.parse(props) as Record<string, unknown>;
    expect(parse('node_card', { title: 'Shared store ' }).title).toBe('Shared store');
    expect(parse('tag', { text: ' Paris' }).text).toBe('Paris');
    const block = parse('data_block', { fields: [{ key: 'text', value: ' Paris' }] });
    expect((block.fields as { value: unknown }[])[0]?.value).toBe('Paris');
  });

  /** Strawberry's `tokens` beat with the tokenizer's b1 narration and two elements added. */
  function spec(): RenderableVideoSpec {
    const copy = structuredClone(goldenStrawberrySpec);
    const script = copy.script.find((s) => s.beatId === 'tokens')!;
    script.narration = TOKENIZER_B1;
    copy.scenes
      .find((s) => s.beatId === 'tokens')!
      .elements.push(
        { id: 'spaced', primitive: 'tag', props: { text: ' Paris' } },
        { id: 'store', primitive: 'node_card', props: { title: 'Shared store ' } },
      );
    return copy;
  }

  const props = (s: RenderableVideoSpec, beatId: string, key: string) => {
    const world = beatWorld(s, effectiveTiming(s), beatId, 30, DEFAULT_REGISTRIES);
    const item = world.find((i) => i.key === key);
    return item?.kind === 'primitive' ? (item.props as Record<string, unknown>) : undefined;
  };

  it('keeps the tokenizer\'s " Paris" tag as ␣Paris: its narration quotes it with the space', () => {
    expect(props(spec(), 'tokens', 'spaced')?.text).toBe('␣Paris');
  });

  it('trims a Generator label "Shared store " that the script never says with a space', () => {
    expect(props(spec(), 'tokens', 'store')?.title).toBe('Shared store');
  });

  it('trims " Paris" on a beat whose script does not quote it', () => {
    const s = spec();
    s.script.find((b) => b.beatId === 'tokens')!.narration = 'Paris is one token.';
    expect(props(s, 'tokens', 'spaced')?.text).toBe('Paris');
  });

  it.each(listThemes().map((t) => [t.id]))(
    '%s: every text style draws ␣ from a bundled font, as wide as a glyph',
    (id) => {
      const theme = getTheme(id);
      for (const style of TEXT_STYLES) {
        expect(textWidth(theme, style, VISIBLE_SPACE)).toBeGreaterThan(
          0.2 * theme.text[style].size,
        );
      }
    },
  );
});
