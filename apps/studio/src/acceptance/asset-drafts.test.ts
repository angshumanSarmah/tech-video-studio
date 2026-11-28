import {
  AssetDetailDtoSchema,
  AssetListResponseSchema,
  DraftJobResponseSchema,
  type MissingAssetRequest,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareRenderAssets } from '#core/assets/render-assets.ts';
import { readDataJson } from '#core/data-files.ts';
import { listRunAssetRequests } from '#core/db/repositories/asset-requests.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { assetRow, DRAFT_ASSET_JOB_TYPE } from '#core/services/asset-drafts.ts';
import { draftAnswer } from '#worker/agents/asset/testing.ts';
import { curateRound } from '#worker/agents/curator/testing.ts';
import type { DryRunResponse } from '#worker/llm/dry-run.ts';
import type { VideoSpec } from '@explainer-studio/shared';
import { Harness } from './harness.ts';

/**
 * P1C.12 A4's acceptance through the API and the dry-run worker: a board's asset request in an
 * all-auto run queues a draft that the Asset drafter draws, and the draft stays pending (every
 * gate on auto approves nothing in the library); the run stops at the draft gate on the missing
 * icon. Approving a variant through the API makes the run's spec resolve the id in a render.
 */

const ALL_AUTO = { research: true, beat_sheet: true, scenes: true, draft: true };
const BEAT = 'b6';
const ELEMENT = 'rare-card';
const REQUEST: MissingAssetRequest = {
  assetId: 'phrasebook',
  description: 'An open phrasebook: a small book with a speech mark on its cover.',
  family: 'object',
  closest: 'globe',
};

let h: Harness;
beforeEach(() => {
  h = new Harness('tokenizer');
});
afterEach(() => h.cleanup());

/** The recorded board of `BEAT` with its card drawn with a new asset, and the request. */
function boardWithRequest(): DryRunResponse[] {
  return h.recordedBoards()[BEAT]!.map((response) => {
    const board = JSON.parse(response.content ?? '{}') as {
      elements: { id: string; props: Record<string, unknown> }[];
      missingAssetRequests?: MissingAssetRequest[];
    };
    const card = board.elements.find((e) => e.id === ELEMENT)!;
    card.props.icon = REQUEST.assetId;
    board.missingAssetRequests = [REQUEST];
    return { ...response, content: JSON.stringify(board) };
  });
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await h.app.request(`/api/assets${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  return { status: res.status, json: (await res.json()) as T };
}

function latestSpec(runId: number): VideoSpec {
  const latest = getLatestSpecVersion(h.t.db, runId)!;
  return readDataJson(h.t.dataDir, latest.jsonPath) as VideoSpec;
}

describe('a run’s asset request', () => {
  it('queues a draft the drafter draws; every gate on auto leaves it pending', async () => {
    h.replaceBoard(BEAT, boardWithRequest());
    const runId = h.start({ autoApprove: ALL_AUTO });
    await h.drain({ ...curateRound('tokenizer'), asset: [draftAnswer()] });

    expect(getRun(h.t.db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_draft',
    });
    expect(listRunAssetRequests(h.t.db, runId)).toMatchObject([
      { assetId: 'phrasebook', beatIds: [BEAT], closest: 'globe' },
    ]);
    const jobs = h.t.db.$client
      .prepare('select run_id, status, payload from jobs where type = ?')
      .all(DRAFT_ASSET_JOB_TYPE);
    expect(jobs).toEqual([
      {
        run_id: null,
        status: 'done',
        payload: JSON.stringify({ assetId: 'phrasebook', round: 1, requestedByRunId: runId }),
      },
    ]);

    const { json: draft } = await api('GET', '/phrasebook');
    expect(AssetDetailDtoSchema.parse(draft)).toMatchObject({
      status: 'draft',
      state: 'ready',
      svgPath: null,
      requests: [{ runId, beatIds: [BEAT], closest: 'globe' }],
    });
    expect(AssetDetailDtoSchema.parse(draft).variants).toHaveLength(3);
    const gate = await h.gate(runId, 'draft');
    expect(gate.blocking.join('\n')).toContain('phrasebook');
    const { json: drafts } = await api('GET', '/drafts');
    expect(AssetListResponseSchema.parse(drafts).items.map((a) => a.id)).toEqual(['phrasebook']);

    const approved = await api('POST', '/drafts/phrasebook/approve', { variant: 3 });
    expect(approved.status).toBe(200);
    expect(AssetDetailDtoSchema.parse(approved.json)).toMatchObject({
      status: 'approved',
      approvedVariant: 3,
      svgPath: 'assets/phrasebook.svg',
    });
    const render = prepareRenderAssets(h.t.db, h.t.dataDir, runId, latestSpec(runId));
    expect(render.missing).toEqual([]);
    expect(render.assets.map((a) => a.id)).toContain('phrasebook');
  });

  it('with auto-drafting off: the request is recorded, nothing is drawn', async () => {
    h.replaceBoard(BEAT, boardWithRequest());
    const runId = h.start({ autoApprove: ALL_AUTO });
    // The run's snapshot holds the setting (the app's `assets.autoDraft`, resolved at start).
    h.t.db.$client
      .prepare(
        "update runs set resolved_settings = json_set(resolved_settings, '$.assets.autoDraft', json('false')) where id = ?",
      )
      .run(runId);
    await h.drain(curateRound('tokenizer'));
    expect(listRunAssetRequests(h.t.db, runId)).toHaveLength(1);
    expect(assetRow(h.t.db, 'phrasebook')).toBeUndefined();
  });
});

describe('the drafts API', () => {
  it('starts a draft by hand (202), refuses a second one and bad requests', async () => {
    const body = { name: 'Write-ahead log', family: 'data', description: 'A log appended first.' };
    const created = await api('POST', '/drafts', body);
    expect(created.status).toBe(202);
    expect(DraftJobResponseSchema.parse(created.json).id).toBe('write_ahead_log');
    expect((await api('POST', '/drafts', body)).status).toBe(409);
    expect((await api('POST', '/drafts', { ...body, family: 'nope' })).status).toBe(400);
    expect((await api('GET', '/nope')).status).toBe(404);
    expect((await api('POST', '/drafts/write_ahead_log/regenerate', { note: 'x' })).status).toBe(
      409,
    );

    await h.drain({ asset: [draftAnswer()] });
    expect((await api('POST', '/drafts/write_ahead_log/approve', { variant: 9 })).status).toBe(400);
    const rejected = await api('POST', '/drafts/write_ahead_log/reject', { note: 'Too busy.' });
    expect(AssetDetailDtoSchema.parse(rejected.json).state).toBe('rejected');
    const again = await api('POST', '/drafts/write_ahead_log/regenerate', { note: 'Simpler.' });
    expect(again.status).toBe(202);
    const { json: list } = await api('GET', '?status=draft&q=write');
    expect(AssetListResponseSchema.parse(list).items).toMatchObject([
      { id: 'write_ahead_log', state: 'queued' },
    ]);
  });
});
