import { SEED_ASSETS } from '@explainer-studio/renderer/catalog';
import { ASSET_FAMILIES } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { pickSheetAssets } from './asset-sheet-pick.ts';

describe('pickSheetAssets', () => {
  it('takes the count across every family, without repeats', () => {
    const picked = pickSheetAssets(SEED_ASSETS, 30);
    expect(picked).toHaveLength(30);
    expect(new Set(picked.map((a) => a.id)).size).toBe(30);
    expect(new Set(picked.map((a) => a.family))).toEqual(new Set(ASSET_FAMILIES));
  });

  it('is independent of input order and never asks for more than there is', () => {
    const ids = (list: typeof SEED_ASSETS) => pickSheetAssets(list, 30).map((a) => a.id);
    expect(ids([...SEED_ASSETS].reverse())).toEqual(ids(SEED_ASSETS));
    expect(pickSheetAssets(SEED_ASSETS.slice(0, 3), 30)).toHaveLength(3);
  });
});
