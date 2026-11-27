import type { MissingAssetRequest, VideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { rateLimiterSpec } from '../../fixtures/index.ts';
import { assetRequestIssues } from './asset-requests.ts';

const request = (
  assetId: string,
  more: Partial<MissingAssetRequest> = {},
): MissingAssetRequest => ({
  assetId,
  description: 'A thing the library lacks.',
  family: 'object',
  closest: 'server',
  ...more,
});

/** The fixture with `icons[i]` on beat i's first node card, and `requests[i]` on its board. */
function spec(icons: string[], requests: MissingAssetRequest[][] = []): VideoSpec {
  const s = structuredClone(rateLimiterSpec) as VideoSpec;
  (s.scenes ?? []).forEach((scene, i) => {
    const icon = icons[i];
    if (icon) {
      scene.elements.push({
        id: `card-${i}`,
        primitive: 'node_card',
        props: { title: 'Thing', icon },
      });
    }
    if (requests[i]?.length) scene.missingAssetRequests = requests[i];
  });
  return s;
}

const codes = (s: VideoSpec) => assetRequestIssues(s).map((i) => `${i.code} ${i.path}`);

describe('assetRequestIssues', () => {
  it('accepts approved ids, and a new id with its request', () => {
    expect(codes(spec(['server']))).toEqual([]);
    expect(codes(spec(['vault_door'], [[request('vault_door')]]))).toEqual([]);
  });

  it('wants a request for a new id, at the place it is used', () => {
    expect(codes(spec(['vault_door']))).toEqual([
      'asset_without_request $.scenes[0].elements[3].props.icon',
    ]);
  });

  it('refuses a request for an approved or near-identical id, or for an id the board does not use', () => {
    expect(codes(spec(['server'], [[request('servers')]]))).toEqual([
      'asset_request_known $.scenes[0].missingAssetRequests[0].assetId',
    ]);
    expect(codes(spec(['vault_door'], [[request('vault_door'), request('tape_reel')]]))).toEqual([
      'asset_request_unused $.scenes[0].missingAssetRequests[1].assetId',
      'asset_requests_per_beat $.scenes[0].missingAssetRequests[1]',
    ]);
  });

  it('wants an approved closest id', () => {
    const issues = assetRequestIssues(
      spec(['vault_door'], [[request('vault_door', { closest: 'safe_box' })]]),
    );
    expect(issues.map((i) => i.code)).toEqual(['asset_request_closest']);
    expect(issues[0]?.message).toMatch(/approved id from ASSETS/);
  });

  it('allows three new ids per video, counting each id once', () => {
    const ids = ['vault_door', 'tape_reel', 'hand_crank', 'paper_slip'];
    const s = spec(
      ids,
      ids.map((id) => [request(id)]),
    );
    expect(codes(s)).toEqual(['asset_requests_per_video $.scenes[3].missingAssetRequests[0]']);
  });
});
