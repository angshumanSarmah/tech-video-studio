import { describe, expect, it } from 'vitest';
import { textWidth } from '../fonts/measure-text.ts';
import { getTheme, listThemes, TEXT_STYLES } from '../theme/index.ts';
import { lineText, showEdgeSpaces, VISIBLE_SPACE } from './common-props.ts';
import { PRIMITIVES } from './registry.ts';

describe('showEdgeSpaces', () => {
  it('draws each leading or trailing space as ␣ and keeps inner spaces', () => {
    expect(VISIBLE_SPACE).toBe('␣');
    expect(showEdgeSpaces(' Paris')).toBe('␣Paris');
    expect(showEdgeSpaces('Paris ')).toBe('Paris␣');
    expect(showEdgeSpaces('  New York  ')).toBe('␣␣New York␣␣');
    expect(showEdgeSpaces('Paris')).toBe('Paris');
  });

  it('trims other edge whitespace, and leaves nothing of whitespace alone', () => {
    expect(showEdgeSpaces('\tParis\n')).toBe('Paris');
    expect(showEdgeSpaces('   ')).toBe('');
    expect(lineText(12, 'x').safeParse('   ').success).toBe(false);
  });
});

describe('screen text keeps its edge spaces visible', () => {
  const parse = (id: string, props: unknown) => {
    const result = PRIMITIVES.get(id)!.propsSchema.safeParse(props);
    if (!result.success) throw new Error(result.error.message);
    return result.data as Record<string, unknown>;
  };

  it('in one-line text (an icon caption), a tag, a counter label and a data value', () => {
    expect(parse('item_icon', { asset: 'document', caption: ' Paris' }).caption).toBe('␣Paris');
    expect(parse('tag', { text: ' Paris' }).text).toBe('␣Paris');
    expect(parse('counter', { value: 1, label: 'Paris ' }).label).toBe('Paris␣');
    const block = parse('data_block', {
      title: 'Spaced',
      fields: [{ key: 'text', value: ' Paris' }],
    });
    expect((block.fields as { value: unknown }[])[0]?.value).toBe('␣Paris');
  });

  it.each(listThemes().map((t) => [t.id]))(
    '%s: every text style draws ␣ from a bundled font, as wide as a glyph',
    (id) => {
      const theme = getTheme(id);
      for (const style of TEXT_STYLES) {
        const width = textWidth(theme, style, VISIBLE_SPACE);
        expect(width).toBeGreaterThan(0.2 * theme.text[style].size);
      }
    },
  );
});
