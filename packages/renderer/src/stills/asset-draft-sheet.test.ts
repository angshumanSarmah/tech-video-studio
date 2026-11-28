import { describe, expect, it } from 'vitest';
import { SEED_ASSETS } from '../assets/seed.ts';
import { getTheme, DEFAULT_THEME_ID } from '../theme/index.ts';
import {
  draftSheetHeight,
  variantAssetId,
  variantAssets,
  type DraftSheetEntry,
} from './asset-draft-sheet.ts';

const shapes = SEED_ASSETS[0]!.shapes;
const entry = (id: string, refused = false): DraftSheetEntry => ({
  id,
  name: 'Example',
  family: 'data',
  description: '<example-description>',
  caption: 'round 1',
  variants: [
    { number: 1, concept: 'a', shapes, problems: [] },
    { number: 2, concept: 'b', shapes: refused ? null : shapes, problems: refused ? ['x'] : [] },
    { number: 3, concept: 'c', shapes, problems: [] },
  ],
});

describe('the asset draft sheet layout', () => {
  const theme = getTheme(DEFAULT_THEME_ID);

  it('grows with its drafts, to an even height', () => {
    const one = draftSheetHeight([entry('a')], theme);
    const two = draftSheetHeight([entry('a'), entry('b')], theme);
    expect(two).toBeGreaterThan(one);
    expect(one % 2).toBe(0);
    expect(two % 2).toBe(0);
  });

  it('draws each passing variant under its own id, and no refused one', () => {
    expect(variantAssets([entry('thread', true)]).map((a) => a.id)).toEqual([
      variantAssetId('thread', 1),
      variantAssetId('thread', 3),
    ]);
  });
});
