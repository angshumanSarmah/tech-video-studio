import { describe, expect, it } from 'vitest';
import { buildAssetRegistry, SEED_REGISTRY } from './library.ts';
import { rankAssets, rankByWords, SUGGESTION_LIMIT, suggestAssets } from './rank.ts';

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

describe('rankAssets', () => {
  it('scores free words from a name and description, with scores', () => {
    const ranked = rankAssets(
      { name: 'Message queue', description: 'ordered backlog of jobs' },
      SEED_REGISTRY,
    );
    expect(ranked[0]?.id).toBe('queue');
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it('reads aliases and descriptions as words of the asset', () => {
    const registry = buildAssetRegistry(
      [...SEED_REGISTRY.values()].map((a) =>
        a.id === 'disk' ? { ...a, aliases: ['hard_drive'], description: 'a spinning platter' } : a,
      ),
    );
    expect(rankAssets({ name: 'platter' }, registry)[0]?.id).toBe('disk');
    expect(rankAssets({ id: 'hard_drive' }, registry)[0]?.id).toBe('disk');
  });

  it('breaks ties by id in code-unit order', () => {
    const ranked = rankAssets({ name: 'order' }, SEED_REGISTRY);
    const tied = ranked.filter((r) => r.score === ranked[0]?.score).map((r) => r.id);
    expect(tied).toEqual([...tied].sort());
  });
});

describe('rankByWords', () => {
  it('counts exact words only, the id first word far above a tag', () => {
    const ranked = rankByWords(['database', 'storage'], SEED_REGISTRY);
    expect(ranked[0]?.id).toBe('database');
    expect(ranked.find((r) => r.id === 'database')?.score).toBeGreaterThan(
      ranked.find((r) => r.id === 'disk')?.score ?? 0,
    );
    // "data" is a prefix of database, not a word of it.
    expect(rankByWords(['data'], SEED_REGISTRY).map((r) => r.id)).not.toContain('database');
  });

  it('folds plurals and leaves out a single tag word (noise)', () => {
    expect(rankByWords(['servers'], SEED_REGISTRY)[0]?.id).toBe('server');
    expect(rankByWords(['backend'], SEED_REGISTRY)).toEqual([]);
  });
});
