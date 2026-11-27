import {
  MAX_ASSET_REQUESTS_PER_BEAT,
  MAX_ASSET_REQUESTS_PER_VIDEO,
  toJsonPath,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import { nearIdenticalAsset } from '../assets/near-identical.ts';
import { suggestAssets } from '../assets/rank.ts';
import { specAssetUses } from './asset-uses.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Checks on the Generator's asset requests (P1C.12, `scene.missingAssetRequests`): a new asset id
 * a board uses before it exists must come with a request, and a request must name an id its
 * board uses that no approved asset already covers, with an approved `closest`; at most one per
 * beat and `MAX_ASSET_REQUESTS_PER_VIDEO` distinct ids per video. Pure; paths into the spec.
 */

export const ASSET_REQUEST_CODES = [
  'asset_without_request',
  'asset_request_known',
  'asset_request_unused',
  'asset_request_closest',
  'asset_requests_per_beat',
  'asset_requests_per_video',
] as const;
export type AssetRequestCode = (typeof ASSET_REQUEST_CODES)[number];

export function assetRequestIssues(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const library = registries.assets;
  const slots = new Set((spec.logos ?? []).map((l) => l.id));
  const uses = specAssetUses(spec, registries).filter((u) => !slots.has(u.id));
  const scenes = spec.scenes ?? [];
  const requested = new Set(
    scenes.flatMap((s) => (s.missingAssetRequests ?? []).map((r) => r.assetId)),
  );
  const issues: SpecError[] = uses
    .filter((use) => !library.has(use.id) && !requested.has(use.id))
    .map((use) => ({
      path: toJsonPath(use.path),
      code: 'asset_without_request',
      message:
        `"${use.id}" is not an approved asset. Use an id from ASSETS, or, when none shows the ` +
        'thing, keep this id and add a missingAssetRequests entry for it (assetId, description, ' +
        'family, closest).',
    }));
  const counted = new Set<string>();
  scenes.forEach((scene, i) => {
    const used = new Set(uses.filter((u) => u.beatId === scene.beatId).map((u) => u.id));
    (scene.missingAssetRequests ?? []).forEach((request, j) => {
      const at = `$.scenes[${i}].missingAssetRequests[${j}]`;
      const issue = (code: AssetRequestCode, field: string, message: string) =>
        issues.push({ path: field ? `${at}.${field}` : at, code, message });
      const known = library.has(request.assetId)
        ? request.assetId
        : nearIdenticalAsset(request.assetId, library);
      if (known !== undefined) {
        issue(
          'asset_request_known',
          'assetId',
          `"${known}" is an approved asset: use it on the board and drop this request.`,
        );
      } else if (!used.has(request.assetId)) {
        issue(
          'asset_request_unused',
          'assetId',
          `This board does not use "${request.assetId}": request only an id the board uses, or drop the request.`,
        );
      }
      if (!library.has(request.closest)) {
        const near = suggestAssets(request.closest, library, request.family);
        issue(
          'asset_request_closest',
          'closest',
          `closest must be an approved id from ASSETS${near.length > 0 ? ` (e.g. ${near.join(', ')})` : ''}.`,
        );
      }
      if (j >= MAX_ASSET_REQUESTS_PER_BEAT) {
        issue(
          'asset_requests_per_beat',
          '',
          `At most ${MAX_ASSET_REQUESTS_PER_BEAT} asset request per beat: draw the rest with listed assets.`,
        );
      }
      if (!counted.has(request.assetId)) {
        counted.add(request.assetId);
        if (counted.size > MAX_ASSET_REQUESTS_PER_VIDEO) {
          issue(
            'asset_requests_per_video',
            '',
            `The video already requests ${MAX_ASSET_REQUESTS_PER_VIDEO} new assets: use "${request.closest}" or another listed asset here.`,
          );
        }
      }
    });
  });
  return issues;
}
