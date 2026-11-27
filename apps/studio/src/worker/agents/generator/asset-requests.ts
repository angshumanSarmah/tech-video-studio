import {
  elementAssetUses,
  nearIdenticalAsset,
  patternAssetUses,
  suggestAssets,
  type Registries,
} from '@explainer-studio/renderer/catalog';
import {
  MAX_ASSET_REQUESTS_PER_BEAT,
  type GeneratorOutput,
  type MissingAssetRequest,
} from '@explainer-studio/shared';

/**
 * What code fixes in a board's asset requests after the Generator's last attempt (P1C.12; its
 * request issues are soft there): a request for an approved (or near-identical) id, or for an id
 * the board does not use, is dropped; requests past the per-beat limit are dropped; a `closest`
 * that is not approved becomes the best suggestion for the requested id. Each change is a line
 * for the step's log. The per-video limit needs every board: the post-pass checks it. Pure.
 */
export function settleAssetRequests(
  board: GeneratorOutput,
  registries: Registries,
): { board: GeneratorOutput; notes: string[] } {
  const requests = board.missingAssetRequests ?? [];
  if (requests.length === 0) return { board, notes: [] };
  const library = registries.assets;
  const used = boardAssetIds(board, registries);
  const notes: string[] = [];
  const kept: MissingAssetRequest[] = [];
  for (const request of requests) {
    const known = library.has(request.assetId)
      ? request.assetId
      : nearIdenticalAsset(request.assetId, library);
    if (known !== undefined) {
      notes.push(`asset request "${request.assetId}" dropped: "${known}" is approved.`);
    } else if (!used.has(request.assetId)) {
      notes.push(`asset request "${request.assetId}" dropped: the board does not use it.`);
    } else if (kept.length >= MAX_ASSET_REQUESTS_PER_BEAT) {
      notes.push(`asset request "${request.assetId}" dropped: one request per beat.`);
    } else {
      kept.push(withApprovedClosest(request, registries, notes));
    }
  }
  const settled: GeneratorOutput = { ...board };
  if (kept.length > 0) settled.missingAssetRequests = kept;
  else delete settled.missingAssetRequests;
  return { board: settled, notes };
}

function withApprovedClosest(
  request: MissingAssetRequest,
  registries: Registries,
  notes: string[],
): MissingAssetRequest {
  if (registries.assets.has(request.closest)) return request;
  const [suggested] = suggestAssets(request.assetId, registries.assets, request.family);
  if (suggested === undefined) {
    notes.push(`asset request "${request.assetId}": closest "${request.closest}" is not approved.`);
    return request;
  }
  notes.push(
    `asset request "${request.assetId}": closest "${request.closest}" read as "${suggested}".`,
  );
  return { ...request, closest: suggested };
}

/** Every asset id the board's elements and pattern instances use. */
function boardAssetIds(board: GeneratorOutput, registries: Registries): Set<string> {
  const ids = [
    ...board.elements.flatMap((element) => elementAssetUses(element, [], '', registries)),
    ...board.patterns.flatMap((pattern) => {
      const definition = registries.patterns.get(pattern.pattern);
      const params = definition?.paramsSchema.safeParse(pattern.params);
      if (!definition || !params?.success) return [];
      return patternAssetUses(pattern.id, definition, params.data, [], '', registries);
    }),
  ].map((use) => use.id);
  return new Set(ids);
}
