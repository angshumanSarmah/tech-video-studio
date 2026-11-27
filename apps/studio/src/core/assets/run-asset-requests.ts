import { specAssetUses } from '@explainer-studio/renderer/catalog';
import type { MissingAssetRequest, VideoSpec } from '@explainer-studio/shared';

/** A spec's asset request as the backlog records it: the request and the beats that use its id. */
export type SpecAssetRequest = MissingAssetRequest & { readonly beatIds: string[] };

/**
 * The asset requests a spec's boards carry (P1C.12), one per requested id (the first board's
 * request wins), only for ids its boards still use and that are not approved now
 * (`isApproved`), each with every beat whose board uses the id. Pure.
 */
export function specAssetRequests(
  spec: VideoSpec,
  isApproved: (id: string) => boolean,
): SpecAssetRequest[] {
  const uses = specAssetUses(spec);
  const byId = new Map<string, MissingAssetRequest>();
  for (const scene of spec.scenes ?? []) {
    for (const request of scene.missingAssetRequests ?? []) {
      if (!byId.has(request.assetId)) byId.set(request.assetId, request);
    }
  }
  return [...byId.values()].flatMap((request) => {
    const beatIds = [...new Set(uses.filter((u) => u.id === request.assetId).map((u) => u.beatId))];
    if (beatIds.length === 0 || isApproved(request.assetId)) return [];
    return [{ ...request, beatIds }];
  });
}
