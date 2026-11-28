import {
  ApproveDraftResponseSchema,
  AssetDetailDtoSchema,
  AssetListResponseSchema,
  DraftJobResponseSchema,
  ResolveMissingAssetResponseSchema,
  RunMissingAssetsResponseSchema,
  type MissingAssetRequest,
  type RenderableVideoSpec,
  type VideoSpec,
} from '@explainer-studio/shared';
import { specAssetUses } from '@explainer-studio/renderer/catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { listRunAssetRequests } from '#core/db/repositories/asset-requests.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { assetRow, DRAFT_ASSET_JOB_TYPE } from '#core/services/asset-drafts.ts';
import { latestCuration } from '#core/services/curation.ts';
import { draftAnswer } from '#worker/agents/asset/testing.ts';
import { curateRound, reviewOf } from '#worker/agents/curator/testing.ts';
import type { DryRunResponse } from '#worker/llm/dry-run.ts';
import { decided, Harness } from './harness.ts';

/**
 * P1C.12 A4 and A5's acceptance through the API and the dry-run worker. A board's asset request
 * queues a draft the Asset drafter draws, never approved by any gate. With every gate on auto the
 * Curator's job swaps the missing id to its `closest` and the run exports, the draft still
 * pending. With the draft gate waiting, the run stops there on the missing icon; approving the
 * draft renders the draft again (only the clip that uses it) and clears the final blocker. At
 * gate 3 one resolution renders the still of every beat that uses the id; a swap is an edit
 * followed by a curate scoped to the changed beat.
 */

const ALL_AUTO = { research: true, beat_sheet: true, scenes: true, draft: true };
const UP_TO_SCENES = { research: true, beat_sheet: true };
const ID = 'phrasebook';
/** Beats and the card whose icon becomes the new id. */
const CARDS: Readonly<Record<string, string>> = { b6: 'rare-card' };
const REQUEST: MissingAssetRequest = {
  assetId: ID,
  description: 'An open phrasebook: a small book with a speech mark on its cover.',
  family: 'object',
  closest: 'globe',
};

let h: Harness;
beforeEach(() => {
  h = new Harness('tokenizer');
});
afterEach(() => h.cleanup());

/** One recorded board with a card drawn with the new id, and the board's request for it. */
function boardWithRequest(beatId: string, elementId: string): DryRunResponse[] {
  return h.recordedBoards()[beatId]!.map((response) => {
    const board = JSON.parse(response.content ?? '{}') as {
      elements: { id: string; props: Record<string, unknown> }[];
      missingAssetRequests?: MissingAssetRequest[];
    };
    const card = board.elements.find((e) => e.id === elementId)!;
    card.props.icon = ID;
    board.missingAssetRequests = [REQUEST];
    return { ...response, content: JSON.stringify(board) };
  });
}

function useNewIcon(cards: Readonly<Record<string, string>> = CARDS): void {
  for (const [beatId, elementId] of Object.entries(cards)) {
    h.replaceBoard(beatId, boardWithRequest(beatId, elementId));
  }
}

async function call<T>(method: string, path: string, body?: unknown) {
  const res = await h.app.request(`/api${path}`, {
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

const usesId = (spec: VideoSpec) => specAssetUses(spec).some((u) => u.id === ID);

describe('a run’s asset request', () => {
  it('all on auto: drafted, swapped to its closest, the run exports; the draft stays pending', async () => {
    useNewIcon();
    const runId = h.start({ autoApprove: ALL_AUTO });
    await h.drain({ ...curateRound('tokenizer'), asset: [draftAnswer()] });

    expect(getRun(h.t.db, runId)?.status).toBe('done');
    expect(listRunAssetRequests(h.t.db, runId)).toMatchObject([
      { assetId: ID, beatIds: ['b6'], closest: 'globe' },
    ]);
    const jobs = h.t.db.$client
      .prepare('select run_id, status, payload from jobs where type = ?')
      .all(DRAFT_ASSET_JOB_TYPE);
    expect(jobs).toEqual([
      {
        run_id: null,
        status: 'done',
        payload: JSON.stringify({ assetId: ID, round: 1, requestedByRunId: runId }),
      },
    ]);
    const report = latestCuration(h.t.db, h.t.dataDir, runId)!.report;
    expect(report.assetSwaps).toEqual([{ assetId: ID, to: 'globe', beatIds: ['b6'] }]);
    const exported = latestSpec(runId);
    expect(usesId(exported)).toBe(false);
    expect(exported.scenes?.flatMap((s) => s.missingAssetRequests ?? [])).toEqual([]);
    expect(assetRow(h.t.db, ID)).toMatchObject({ status: 'draft', svgPath: null });
    expect(assetRow(h.t.db, ID)!.variants).toHaveLength(3);
  });

  it('with auto-drafting off: the request is recorded, nothing is drawn', async () => {
    useNewIcon();
    const runId = h.start({ autoApprove: ALL_AUTO });
    // The run's snapshot holds the setting (the app's `assets.autoDraft`, resolved at start).
    h.t.db.$client
      .prepare(
        "update runs set resolved_settings = json_set(resolved_settings, '$.assets.autoDraft', json('false')) where id = ?",
      )
      .run(runId);
    await h.drain(curateRound('tokenizer'));
    expect(listRunAssetRequests(h.t.db, runId)).toHaveLength(1);
    expect(assetRow(h.t.db, ID)).toBeUndefined();
  });
});

describe('resolving a missing asset at the draft gate', () => {
  it('approving its draft renders only that clip again and clears the final blocker', async () => {
    useNewIcon();
    const runId = h.start({ autoApprove: { ...UP_TO_SCENES, scenes: true } });
    await h.drain({ ...curateRound('tokenizer'), asset: [draftAnswer()] });
    expect(getRun(h.t.db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_draft',
    });
    const before = await h.gate(runId, 'draft');
    expect(before.blocking.join('\n')).toContain(ID);
    expect(before.badges).toContainEqual(
      expect.objectContaining({ beatId: 'b6', code: 'asset_missing', owner: 'generator' }),
    );
    const listed = await call('GET', `/runs/${runId}/missing-assets`);
    const missing = RunMissingAssetsResponseSchema.parse(listed.json);
    expect(missing).toMatchObject({ gate: 'draft', items: [{ id: ID, beatIds: ['b6'] }] });
    expect(missing.items[0]).toMatchObject({
      request: { closest: 'globe' },
      draft: { status: 'draft', state: 'ready', approvable: [1, 2, 3] },
    });
    expect(missing.items[0]!.suggestions.length).toBeLessThanOrEqual(3);

    const approved = await call('POST', `/assets/drafts/${ID}/approve`, { variant: 2 });
    expect(ApproveDraftResponseSchema.parse(approved.json).refreshed).toEqual([runId]);
    expect(getRun(h.t.db, runId)).toMatchObject({ status: 'running', pipelineStep: 'draft' });
    await h.drain();

    const after = await h.gate(runId, 'draft');
    expect(after).toMatchObject({ waiting: true, blocking: [] });
    expect(after.badges.filter((b) => b.code === 'asset_missing')).toEqual([]);
    const clips = h.renders.videos.map((v) => (v.inputProps as { beatId?: string }).beatId);
    expect(clips).toEqual(['b6']);
    await decided(
      await h.post(runId, 'draft', { action: 'approve', subjectId: after.subject!.id }),
    );
    await h.drain();
    expect(getRun(h.t.db, runId)?.status).toBe('done');
  });

  it('a skip is recorded; the final render stays refused', async () => {
    useNewIcon();
    const runId = h.start({ autoApprove: { ...UP_TO_SCENES, scenes: true } });
    await h.drain({ ...curateRound('tokenizer'), asset: [draftAnswer()] });
    const skipped = await call('POST', `/runs/${runId}/missing-assets/${ID}`, {
      action: 'skip',
      note: 'Later.',
    });
    expect(ResolveMissingAssetResponseSchema.parse(skipped.json)).toMatchObject({
      action: 'skip',
      run: { status: 'awaiting_review', step: 'gate_draft' },
    });
    expect(h.logs(runId).join('\n')).toContain(`Missing asset ${ID} skipped: Later.`);
    expect((await h.gate(runId, 'draft')).blocking.join('\n')).toContain(ID);
    const again = await call('POST', `/runs/${runId}/missing-assets/nope`, { action: 'skip' });
    expect(again.status).toBe(409);
  });
});

describe('resolving a missing asset at the scenes gate', () => {
  it('one approval renders the still of every beat that uses it, on the same subject', async () => {
    useNewIcon({ b3: 'merge', b6: 'rare-card' });
    const runId = h.start({ autoApprove: UP_TO_SCENES });
    await h.drain({ ...curateRound('tokenizer'), asset: [draftAnswer()] });
    expect(getRun(h.t.db, runId)?.pipelineStep).toBe('gate_scenes');
    const subject = (await h.gate(runId, 'scenes')).subject!.id;

    const resolved = await call('POST', `/runs/${runId}/missing-assets/${ID}`, {
      action: 'approve-draft',
      variant: 1,
    });
    expect(ResolveMissingAssetResponseSchema.parse(resolved.json)).toMatchObject({
      run: { status: 'running', step: 'stills' },
      refreshed: [runId],
    });
    await h.drain();

    const gate = await h.gate(runId, 'scenes');
    expect(gate).toMatchObject({ waiting: true, subject: { id: subject } });
    const drawnWith = (beatId: string) =>
      h.renders.stills
        .filter((s) => (s.inputProps as { beatId: string }).beatId === beatId)
        .flatMap((s) => (s.inputProps as { assets: { id: string; kind: string }[] }).assets);
    for (const beatId of ['b3', 'b6']) {
      expect(drawnWith(beatId)).toContainEqual(
        expect.objectContaining({ id: ID, kind: 'library' }),
      );
    }
    expect(gate.badges.filter((b) => b.code === 'asset_missing')).toEqual([]);
  });

  it('a swap is an edit of every use, then a curate scoped to the changed beat', async () => {
    useNewIcon();
    const runId = h.start({ autoApprove: UP_TO_SCENES });
    await h.drain({ ...curateRound('tokenizer'), asset: [draftAnswer()] });
    const before = (await h.gate(runId, 'scenes')).subject!.id;

    const swapped = await call('POST', `/runs/${runId}/missing-assets/${ID}`, {
      action: 'swap',
      to: 'globe',
    });
    expect(swapped.status).toBe(200);
    const bad = await call('POST', `/runs/${runId}/missing-assets/${ID}`, {
      action: 'swap',
      to: 'nope',
    });
    expect(bad.status).toBe(409);
    // The scoped review of the edited version: its claims, no new issue, each earlier one open.
    const earlier = latestCuration(h.t.db, h.t.dataDir, runId)!.report.review?.issues ?? [];
    const previous = earlier.map((_, i) => ({ id: `issue-${i + 1}`, status: 'not_fixed' }));
    const edited = latestSpec(runId) as RenderableVideoSpec;
    await h.drain({ curator: reviewOf(edited, [], previous) });

    const gate = await h.gate(runId, 'scenes');
    expect(gate.waiting).toBe(true);
    expect(gate.subject!.id).not.toBe(before);
    expect(usesId(latestSpec(runId))).toBe(false);
    expect(latestCuration(h.t.db, h.t.dataDir, runId)!.report.scope).toMatchObject({
      sinceSpecVersionId: before,
      changedBeatIds: ['b6'],
    });
    expect(assetRow(h.t.db, ID)?.status).toBe('draft');
  });
});

describe('the drafts API', () => {
  it('starts a draft by hand (202), refuses a second one and bad requests', async () => {
    const body = { name: 'Write-ahead log', family: 'data', description: 'A log appended first.' };
    const created = await call('POST', '/assets/drafts', body);
    expect(created.status).toBe(202);
    expect(DraftJobResponseSchema.parse(created.json).id).toBe('write_ahead_log');
    expect((await call('POST', '/assets/drafts', body)).status).toBe(409);
    expect((await call('POST', '/assets/drafts', { ...body, family: 'nope' })).status).toBe(400);
    expect((await call('GET', '/assets/nope')).status).toBe(404);
    const early = await call('POST', '/assets/drafts/write_ahead_log/regenerate', { note: 'x' });
    expect(early.status).toBe(409);

    await h.drain({ asset: [draftAnswer()] });
    const wrong = await call('POST', '/assets/drafts/write_ahead_log/approve', { variant: 9 });
    expect(wrong.status).toBe(400);
    const rejected = await call('POST', '/assets/drafts/write_ahead_log/reject', {
      note: 'Too busy.',
    });
    expect(AssetDetailDtoSchema.parse(rejected.json).state).toBe('rejected');
    const again = await call('POST', '/assets/drafts/write_ahead_log/regenerate', {
      note: 'Simpler.',
    });
    expect(again.status).toBe(202);
    const { json: list } = await call('GET', '/assets?status=draft&q=write');
    expect(AssetListResponseSchema.parse(list).items).toMatchObject([
      { id: 'write_ahead_log', state: 'queued' },
    ]);
  });
});
