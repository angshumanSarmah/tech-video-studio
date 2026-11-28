import {
  AssetListQuerySchema,
  DraftNoteRequestSchema,
  type ApproveDraftResponse,
  type AssetDetailDto,
  type AssetListResponse,
  type DraftJobResponse,
  type ResolveMissingAssetResponse,
  type RunMissingAssetsResponse,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { uploadAsset } from '#core/services/asset-upload.ts';
import {
  activeDraftJob,
  assetDetail,
  createDraft,
  draftState,
  listAssets,
  regenerateDraft,
  rejectDraft,
  type AssetListFilter,
} from '#core/services/asset-drafts.ts';
import {
  approveDraftAndRefresh,
  resolveMissingAsset,
  runMissingAssets,
} from '#core/services/missing-assets.ts';
import { IdParamSchema } from '@explainer-studio/shared';
import { toAssetDetailDto, toAssetSummaryDto } from '../dto.ts';
import { validate } from '../validate.ts';

const AssetParamsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * The asset library and its drafts (P1C.12 A4): list and view, upload an SVG (sanitized, then
 * approved), ask for a draft (queues the Asset drafter, 202), approve one variant, reject, or
 * regenerate with a note (202). The server never calls a model; nothing is approved except by
 * an approve request.
 */
export function createAssetsRoute(db: Db, dataDir: string) {
  const list = (filter: AssetListFilter) =>
    listAssets(db, filter).map((row) =>
      toAssetSummaryDto(row, draftState(row, activeDraftJob(db, row.id))),
    );
  const detail = (id: string) => toAssetDetailDto(assetDetail(db, dataDir, id));
  return new Hono()
    .get('/', validate('query', AssetListQuerySchema), (c) =>
      c.json<AssetListResponse>({ items: list(c.req.valid('query')) }),
    )
    .post('/', async (c) => {
      const body: unknown = await c.req.json().catch(() => undefined);
      const { asset, fixes } = uploadAsset(db, dataDir, body);
      return c.json({ asset: detail(asset.id), fixes }, 201);
    })
    .get('/drafts', (c) => c.json<AssetListResponse>({ items: list({ status: 'draft' }) }))
    .post('/drafts', async (c) => {
      const body: unknown = await c.req.json().catch(() => undefined);
      const { row, job } = db.transaction((tx) => createDraft(tx, body));
      return c.json<DraftJobResponse>({ id: row.id, jobId: job.id }, 202);
    })
    .post('/drafts/:id/approve', validate('param', AssetParamsSchema), async (c) => {
      const { id } = c.req.valid('param');
      const body: unknown = await c.req.json().catch(() => undefined);
      const { refreshed } = approveDraftAndRefresh(db, dataDir, id, body);
      return c.json<ApproveDraftResponse>({ asset: detail(id), refreshed });
    })
    .post(
      '/drafts/:id/reject',
      validate('param', AssetParamsSchema),
      validate('json', DraftNoteRequestSchema),
      (c) => {
        const { id } = c.req.valid('param');
        db.transaction((tx) => rejectDraft(tx, id, c.req.valid('json').note));
        return c.json<AssetDetailDto>(detail(id));
      },
    )
    .post(
      '/drafts/:id/regenerate',
      validate('param', AssetParamsSchema),
      validate('json', DraftNoteRequestSchema),
      (c) => {
        const { id } = c.req.valid('param');
        const { job } = db.transaction((tx) => regenerateDraft(tx, id, c.req.valid('json').note));
        return c.json<DraftJobResponse>({ id, jobId: job.id }, 202);
      },
    )
    .get('/:id', validate('param', AssetParamsSchema), (c) =>
      c.json<AssetDetailDto>(detail(c.req.valid('param').id)),
    );
}

const MissingParamsSchema = z.object({ id: IdParamSchema, assetId: z.string().min(1).max(64) });

/**
 * A run's missing assets (P1C.12 A5), mounted under `/runs`: the live list (uses, request, draft,
 * suggestions), and resolving one at gate 3 or 4 (approve a draft variant, swap, skip).
 */
export function createRunMissingAssetsRoute(db: Db, dataDir: string) {
  return new Hono()
    .get('/:id/missing-assets', validate('param', z.object({ id: IdParamSchema })), (c) =>
      c.json<RunMissingAssetsResponse>(runMissingAssets(db, dataDir, c.req.valid('param').id)),
    )
    .post('/:id/missing-assets/:assetId', validate('param', MissingParamsSchema), async (c) => {
      const { id, assetId } = c.req.valid('param');
      const body: unknown = await c.req.json().catch(() => undefined);
      return c.json<ResolveMissingAssetResponse>(
        resolveMissingAsset(db, dataDir, id, assetId, body),
      );
    });
}
