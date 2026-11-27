import { DEFAULT_REGISTRIES } from '@explainer-studio/renderer/catalog';
import type { GeneratorOutput, MissingAssetRequest } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { settleAssetRequests } from './asset-requests.ts';

const request = (assetId: string, closest = 'key'): MissingAssetRequest => ({
  assetId,
  description: 'A thing.',
  family: 'security',
  closest,
});

function board(icons: string[], requests: MissingAssetRequest[]): GeneratorOutput {
  return {
    elements: icons.map((icon, i) => ({
      id: `card-${i}`,
      primitive: 'node_card',
      props: { title: 'Thing', icon },
    })),
    patterns: [],
    events: [],
    focus: [],
    transitionIn: 'cut',
    missingAssetRequests: requests,
  };
}

const settle = (b: GeneratorOutput) => settleAssetRequests(b, DEFAULT_REGISTRIES);

describe('settleAssetRequests', () => {
  it('keeps a valid request as it is', () => {
    const b = board(['vault_door'], [request('vault_door')]);
    expect(settle(b)).toEqual({ board: b, notes: [] });
  });

  it('drops requests for approved, near-identical or unused ids, and past one per beat', () => {
    const { board: settled, notes } = settle(
      board(
        ['vault_door', 'tape_reel'],
        [request('keys'), request('hand_crank'), request('vault_door'), request('tape_reel')],
      ),
    );
    expect(settled.missingAssetRequests).toEqual([request('vault_door')]);
    expect(notes).toEqual([
      'asset request "keys" dropped: "key" is approved.',
      'asset request "hand_crank" dropped: the board does not use it.',
      'asset request "tape_reel" dropped: one request per beat.',
    ]);
  });

  it('reads an unapproved closest as the best suggestion, and removes an empty list', () => {
    const { board: fixed, notes } = settle(board(['lock_box'], [request('lock_box', 'safe')]));
    expect(fixed.missingAssetRequests?.[0]?.closest).toBe('lock');
    expect(notes[0]).toMatch(/closest "safe" read as "lock"/);
    expect('missingAssetRequests' in settle(board(['key'], [request('key')])).board).toBe(false);
  });
});
