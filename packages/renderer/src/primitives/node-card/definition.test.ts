import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { approxTextWidth } from '../measure.ts';
import {
  NODE_SUBTITLE_MAX,
  NodeCardPropsSchema,
  nodeCardSizeHints,
  subtitleWidth,
} from './definition.ts';

const theme = getTheme('drafting-paper');

describe('node_card subtitle', () => {
  it('caps the subtitle length in the schema, so the Generator sees the limit', () => {
    const ok = 'x'.repeat(NODE_SUBTITLE_MAX);
    expect(NodeCardPropsSchema.safeParse({ title: 'A', subtitle: ok }).success).toBe(true);
    expect(NodeCardPropsSchema.safeParse({ title: 'A', subtitle: `${ok}x` }).success).toBe(false);
  });

  it('widens the card to hold the subtitle on one line, with slack, up to a max', () => {
    const subtitle = '12 MS · CPU 40%';
    expect(subtitleWidth(theme, subtitle)).toBeGreaterThan(
      approxTextWidth(theme, 'label', subtitle),
    );
    const plain = nodeCardSizeHints(NodeCardPropsSchema.parse({ title: 'A' }), theme);
    const wide = nodeCardSizeHints(NodeCardPropsSchema.parse({ title: 'A', subtitle }), theme);
    expect(wide.preferredWidth).toBeGreaterThan(plain.preferredWidth);
    const longest = subtitleWidth(theme, 'W'.repeat(NODE_SUBTITLE_MAX));
    expect(longest).toBe(approxTextWidth(theme, 'label', 'M'.repeat(NODE_SUBTITLE_MAX)));
  });
});
