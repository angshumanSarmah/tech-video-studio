import type { LibraryAsset, VideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { rateLimiterSpec } from '../../fixtures/index.ts';
import { buildAssetRegistry, SEED_REGISTRY } from '../assets/library.ts';
import { beatAssetLines, beatAssets, MAX_BEAT_ASSETS } from './beat-assets.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

const seed = [...SEED_REGISTRY.values()];
const base = seed[0] as LibraryAsset;
const extra = (id: string, tags: string[] = []): LibraryAsset => ({
  ...base,
  id,
  name: id.replaceAll('_', ' '),
  family: 'object',
  tags,
  source: `lucide@1.0.0:${id.replaceAll('_', '-')}`,
});
const withAssets = (assets: LibraryAsset[]): Registries => ({
  ...DEFAULT_REGISTRIES,
  assets: buildAssetRegistry([...seed, ...assets]),
});

/** The rate-limiter fixture with a server icon on beat 1's client card and a headline on beat 2. */
function spec(headline = 'Every request spends a token'): VideoSpec {
  const s = structuredClone(rateLimiterSpec) as VideoSpec;
  const client = s.scenes?.[0]?.elements[0];
  if (!client) throw new Error('fixture changed');
  client.props = { title: 'Client', icon: 'laptop' };
  const script = s.script?.[1];
  if (script) script.headline = { text: headline, semantic: 'concept' };
  return s;
}

const ids = (list: ReturnType<typeof beatAssets>) => list.map((a) => a.asset.id);

describe('beatAssets', () => {
  it('lists at most 60, sorted by family then id, whatever the library order', () => {
    const list = beatAssets(spec(), 1, DEFAULT_REGISTRIES);
    expect(list).toHaveLength(MAX_BEAT_ASSETS);
    const keys = list.map((a) => `${a.asset.family}/${a.asset.id}`);
    expect(keys).toEqual([...keys].sort());
    const reversed = { ...DEFAULT_REGISTRIES, assets: buildAssetRegistry([...seed].reverse()) };
    expect(ids(beatAssets(spec(), 1, reversed))).toEqual(ids(list));
  });

  it("puts this video's ids first and marks them, but only from earlier boards", () => {
    const later = beatAssets(spec(), 1, DEFAULT_REGISTRIES);
    expect(later.find((a) => a.asset.id === 'laptop')).toEqual(
      expect.objectContaining({ usedInVideo: true }),
    );
    expect(beatAssets(spec(), 0, DEFAULT_REGISTRIES).some((a) => a.usedInVideo)).toBe(false);
    expect(beatAssetLines(later).find((l) => l.startsWith('- laptop '))).toMatch(
      /\[used in this video\]$/,
    );
  });

  it('lists exact matches for the beat key words, at most two per first word', () => {
    const registries = withAssets([
      extra('snail', ['slow']),
      ...['book_a', 'book_b', 'book_c', 'book_d'].map((id) => extra(id)),
      extra('notebook_snail'),
    ]);
    const list = ids(beatAssets(spec('A snail reads a book'), 1, registries));
    expect(list).toContain('snail');
    // The core `book` shares the first word: two of the five in all.
    expect(list.filter((id) => id === 'book' || id.startsWith('book_'))).toEqual([
      'book',
      'book_a',
    ]);
    // A tag word or a modifier word alone is noise.
    expect(ids(beatAssets(spec('Everything is slow'), 1, registries))).not.toContain('snail');
  });

  it("fills the rest with core assets of the topic class's families, in their order", () => {
    const list = beatAssets(spec(), 1, DEFAULT_REGISTRIES);
    const families = new Set(list.map((a) => a.asset.family));
    // concept: symbol, data, infra, network, time, people, security.
    expect(families.has('symbol')).toBe(true);
    expect(families.has('transport')).toBe(false);
  });
});
