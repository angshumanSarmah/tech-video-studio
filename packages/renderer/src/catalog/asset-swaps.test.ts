import { describe, expect, it } from 'vitest';
import { nameForms, nearIdenticalAsset } from '../assets/near-identical.ts';
import { buildAssetRegistry, SEED_REGISTRY } from '../assets/library.ts';
import { boardAssetSwaps, withAssetSwaps } from './asset-swaps.ts';
import { DEFAULT_REGISTRIES } from './registries.ts';
import { paramLeaves, propLeaves, schemaLeaves } from './schema-leaves.ts';

const primitive = (id: string) => {
  const found = DEFAULT_REGISTRIES.primitives.get(id);
  if (!found) throw new Error(`no primitive ${id}`);
  return found;
};

describe('nearIdenticalAsset', () => {
  it('matches plurals, separators and a declared alias', () => {
    expect(SEED_REGISTRY.has('server')).toBe(true);
    expect(nearIdenticalAsset('servers', SEED_REGISTRY)).toBe('server');
    expect(nearIdenticalAsset('shield-check', SEED_REGISTRY)).toBe('shield_check');
    expect(nearIdenticalAsset('databases', SEED_REGISTRY)).toBe('database');
  });

  it('follows the aliases the registry declares, in any near-identical form', () => {
    const withAlias = buildAssetRegistry(
      [...SEED_REGISTRY.values()].map((a) =>
        a.id === 'gpu' ? { ...a, aliases: ['gpu_card'] } : a,
      ),
    );
    expect(nearIdenticalAsset('gpu_card', withAlias)).toBe('gpu');
    expect(nearIdenticalAsset('gpu-cards', withAlias)).toBe('gpu');
    expect(nearIdenticalAsset('GPU_Card', withAlias)).toBe('gpu');
    expect(nearIdenticalAsset('gpu_card', SEED_REGISTRY)).toBeUndefined();
  });

  it('prefers an exact alias over a plural form of another id', () => {
    const registry = buildAssetRegistry(
      [...SEED_REGISTRY.values()].map((a) =>
        a.id === 'cluster' ? { ...a, aliases: ['servers'] } : a,
      ),
    );
    expect(nearIdenticalAsset('servers', registry)).toBe('cluster');
  });

  it('leaves known ids and anything that is not near-identical alone', () => {
    expect(nearIdenticalAsset('server', SEED_REGISTRY)).toBeUndefined();
    expect(nearIdenticalAsset('rack_server', SEED_REGISTRY)).toBeUndefined();
    expect(nearIdenticalAsset('serve', SEED_REGISTRY)).toBeUndefined();
  });

  it('tries a fixed set of forms in a fixed order', () => {
    expect(nameForms('box-es')).toEqual([
      'box-es',
      'box-',
      'box-e',
      'box-ess',
      'box-eses',
      'box_es',
      'box_',
      'box_e',
      'box_ess',
      'box_eses',
    ]);
  });
});

describe('schemaLeaves', () => {
  it('finds screen text and asset ids in props, skipping ids, enums and pins', () => {
    const leaves = propLeaves(primitive('node_card'), {
      title: 'Cache',
      subtitle: 'hot keys',
      icon: 'database',
      semantic: 'focus',
    });
    expect(leaves).toEqual([
      { kind: 'text', path: ['title'], value: 'Cache' },
      { kind: 'text', path: ['subtitle'], value: 'hot keys' },
      { kind: 'asset', path: ['icon'], value: 'database' },
    ]);
    const tag = propLeaves(primitive('tag'), { text: '429', pin: { to: 'api', side: 'top' } });
    expect(tag).toEqual([{ kind: 'text', path: ['text'], value: '429' }]);
  });

  it("walks a pattern's params without its anchors", () => {
    const failover = DEFAULT_REGISTRIES.patterns.get('failover');
    if (!failover) throw new Error('no failover');
    const leaves = paramLeaves(failover, {
      writer: { title: 'App', icon: 'servers' },
      at: { steady: { type: 'word_text', text: 'leader' } },
    });
    expect(leaves).toEqual([
      { kind: 'text', path: ['writer', 'title'], value: 'App' },
      { kind: 'asset', path: ['writer', 'icon'], value: 'servers' },
    ]);
  });

  it('reads display numbers and their unit from schema metadata', () => {
    const node = {
      type: 'object',
      properties: {
        sec: { type: 'number', displayNumber: { unit: 'sec' } },
        n: { type: 'number' },
      },
    };
    expect(schemaLeaves(node, { sec: 600, n: 3 })).toEqual([
      { kind: 'number', path: ['sec'], value: 600, unit: 'sec' },
    ]);
  });
});

describe('boardAssetSwaps', () => {
  const board = {
    elements: [{ primitive: 'node_card', props: { title: 'Store', icon: 'databases' } }],
    patterns: [{ pattern: 'failover', params: { writer: { title: 'App', icon: 'servers' } } }],
  };

  it('finds near-identical ids in props and params, with board-relative paths', () => {
    expect(boardAssetSwaps(board, DEFAULT_REGISTRIES)).toEqual([
      { path: ['elements', 0, 'props', 'icon'], from: 'databases', to: 'database' },
      { path: ['patterns', 0, 'params', 'writer', 'icon'], from: 'servers', to: 'server' },
    ]);
  });

  it('leaves logo slots and unknown ids without a near match alone', () => {
    const logos = {
      elements: [{ primitive: 'node_card', props: { title: 'X', icon: 'logo_acmes' } }],
      patterns: [],
    };
    expect(boardAssetSwaps(logos, DEFAULT_REGISTRIES, new Set(['logo_acmes']))).toEqual([]);
    const far = {
      elements: [{ primitive: 'node_card', props: { title: 'X', icon: 'quantum_bus' } }],
      patterns: [],
    };
    expect(boardAssetSwaps(far, DEFAULT_REGISTRIES)).toEqual([]);
  });

  it('applies swaps to a copy', () => {
    const swapped = withAssetSwaps(board, boardAssetSwaps(board, DEFAULT_REGISTRIES));
    expect(swapped.elements[0]?.props.icon).toBe('database');
    expect(swapped.patterns[0]?.params.writer.icon).toBe('server');
    expect(board.elements[0]?.props.icon).toBe('databases');
  });
});
