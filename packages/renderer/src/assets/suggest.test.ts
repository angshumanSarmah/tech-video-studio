import { describe, expect, it } from 'vitest';
import { buildAssetRegistry, SEED_REGISTRY } from './library.ts';
import { SUGGESTION_LIMIT, suggestAssets } from './suggest.ts';

const suggest = (id: string, family?: Parameters<typeof suggestAssets>[2]) =>
  suggestAssets(id, SEED_REGISTRY, family);

describe('suggestAssets', () => {
  it.each([
    ['db', 'database'],
    ['databases', 'database'],
    ['lock_closed', 'lock'],
    ['rocket_ship', 'rocket'],
    ['gpu_card', 'gpu'],
    ['load_balancer', 'split'],
    ['kafka_queue', 'queue'],
    ['llm', 'bot'],
    ['user_profile', 'user'],
  ])('ranks the expected id first for "%s"', (unknown, expected) => {
    expect(suggest(unknown)[0]).toBe(expected);
  });

  it('keeps related ids among the suggestions', () => {
    expect(suggest('lock_closed')).toEqual(expect.arrayContaining(['lock', 'unlock']));
    expect(suggest('gpu_card').slice(0, 2)).toEqual(['gpu', 'credit_card']);
  });

  it('suggests only real matches, at most the cap', () => {
    for (const id of ['db', 'lock_closed', 'load_balancer', 'user_profile']) {
      const ids = suggest(id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThanOrEqual(SUGGESTION_LIMIT);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(SUGGESTION_LIMIT).toBe(6);
    expect(suggest('load_balancer')).toHaveLength(SUGGESTION_LIMIT);
    expect(suggest('db')).toEqual(['database']);
  });

  it('suggests nothing when nothing is close (no filler)', () => {
    expect(suggest('qwzx')).toEqual([]);
    expect(suggest('taxi', 'transport')).toEqual([]);
  });

  it('puts the implied family first', () => {
    expect(suggest('box')[0]).toBe('archive');
    expect(suggest('box', 'object')[0]).toBe('package');
    expect(suggest('delivery')).toEqual(['package', 'pizza', 'truck']);
    expect(suggest('delivery', 'transport')).toEqual(['truck', 'package', 'pizza']);
    expect(suggest('leader', 'symbol')[0]).toBe('crown');
  });

  it('is deterministic and independent of library order', () => {
    const reversed = buildAssetRegistry([...SEED_REGISTRY.values()].reverse());
    for (const id of ['db', 'load_balancer', 'lock_closed']) {
      expect(suggestAssets(id, reversed)).toEqual(suggest(id));
    }
  });

  it('returns nothing for an empty library', () => {
    expect(suggestAssets('db', new Map())).toEqual([]);
  });
});
