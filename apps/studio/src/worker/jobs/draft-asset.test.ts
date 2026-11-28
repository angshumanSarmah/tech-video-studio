import { existsSync, readFileSync } from 'node:fs';
import { parseHouseSvg, specAssetUses } from '@explainer-studio/renderer/catalog';
import type { DraftSheetProps } from '@explainer-studio/renderer/catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAssetLibrary } from '#core/assets/library.ts';
import { prepareRenderAssets } from '#core/assets/render-assets.ts';
import { readDataText, resolveDataPath } from '#core/data-files.ts';
import { getJob, listJobsByStatus } from '#core/db/repositories/jobs.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { ConflictError, InvalidEditError } from '#core/errors.ts';
import {
  approveDraft,
  assetDetail,
  assetRow,
  createDraft,
  regenerateDraft,
  rejectDraft,
} from '#core/services/asset-drafts.ts';
import { fixtureGeneratedSpec } from '#worker/agents/generator/testing.ts';
import {
  CONCEPTS,
  DRAFT_SVGS,
  draftAnswer,
  draftRunner,
  HEX_SVG,
  SCRIPT_SVG,
} from '../agents/asset/testing.ts';

/**
 * P1C.12 A4's acceptance for drafting: a dry-run draft gives three pending variants and a
 * preview sheet; approving one puts it in the library, so a render resolves its id; a draft is
 * never approved by anything but an approve.
 */

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.cleanup());

const REQUEST = {
  name: 'Example thread',
  family: 'dev',
  description: 'A single line of work running on a processor.',
};

function start(request: object = REQUEST) {
  return t.db.transaction((tx) => createDraft(tx, request));
}

/** Prompts the drafter was sent, as text, in call order. */
function drafterPrompts(): string[] {
  return t.db.$client
    .prepare("select prompt_path from llm_calls where role = 'asset' order by id")
    .all()
    .map((r) => {
      const path = resolveDataPath(t.dataDir, (r as { prompt_path: string }).prompt_path);
      const file = JSON.parse(readFileSync(path, 'utf8')) as { messages: { content: string }[] };
      return file.messages.map((m) => m.content).join('\n\n');
    });
}

describe('a dry-run draft', () => {
  it('gives three pending variants, their files and a preview sheet', async () => {
    const { row, job } = start();
    expect(row).toMatchObject({ id: 'example_thread', status: 'draft', svgPath: null });
    const drafter = draftRunner(t.db, t.dataDir, [draftAnswer()]);
    expect(await drafter.next()).toBe(true);
    expect(getJob(t.db, job.id)).toMatchObject({ status: 'done', runId: null });

    const detail = assetDetail(t.db, t.dataDir, row.id);
    expect(detail.state).toBe('ready');
    expect(detail.row.status).toBe('draft');
    expect(detail.row.variants.map((v) => [v.number, v.round, v.concept])).toEqual([
      [1, 1, CONCEPTS[0]],
      [2, 1, CONCEPTS[1]],
      [3, 1, CONCEPTS[2]],
    ]);
    for (const v of detail.row.variants) {
      expect(v).toMatchObject({ problems: [], prompt: 'asset@v1', model: 'deepseek-flash' });
      expect(parseHouseSvg(readDataText(t.dataDir, v.svgPath!)).ok).toBe(true);
    }
    expect(loadAssetLibrary(t.db, t.dataDir, [row.id]).assets).toEqual([]);

    expect(drafter.sheets).toHaveLength(1);
    const props = drafter.sheets[0]!.inputProps as DraftSheetProps;
    expect(props.drafts[0]!.variants.map((v) => v.shapes !== null)).toEqual([true, true, true]);
    expect(detail.sheetPath).toBe('assets/drafts/example_thread/sheet-1.png');
    expect(existsSync(resolveDataPath(t.dataDir, detail.sheetPath!))).toBe(true);
  });

  it('tells the drafter the request and style examples of its family, with no video preamble', async () => {
    start();
    await draftRunner(t.db, t.dataDir, [draftAnswer()]).next();
    const [prompt] = drafterPrompts();
    expect(prompt).toContain('Role: Asset drafter.');
    expect(prompt).not.toContain('Tech Explainer Studio, a pipeline');
    expect(prompt).toContain('## HOUSE STYLE');
    expect(prompt).toContain('id: example_thread');
    expect(prompt).toMatch(/EXAMPLES[^\n]*\n- \S+ \(dev\)/);
  });

  it('repairs only the failing variant, then keeps all three', async () => {
    start();
    const drafter = draftRunner(t.db, t.dataDir, [
      draftAnswer([DRAFT_SVGS[0], HEX_SVG, DRAFT_SVGS[2]]),
      draftAnswer(),
    ]);
    await drafter.next();
    const row = assetRow(t.db, 'example_thread')!;
    expect(row.variants.map((v) => v.svgPath !== null)).toEqual([true, true, true]);
    expect(row.variants[0]!.callIds).toHaveLength(2);
    const repair = drafterPrompts()[1]!;
    expect(repair).toContain('Fix variant 2 only; keep the other variants as they are.');
  });

  it('keeps what the last attempt could not fix, refused with its problems', async () => {
    start();
    const bad = draftAnswer([DRAFT_SVGS[0], SCRIPT_SVG, DRAFT_SVGS[2]]);
    const drafter = draftRunner(t.db, t.dataDir, [bad, bad, bad]);
    await drafter.next();
    const detail = assetDetail(t.db, t.dataDir, 'example_thread');
    expect(detail.state).toBe('ready');
    expect(detail.row.variants[1]).toMatchObject({ number: 2, svgPath: null });
    expect(detail.row.variants[1]!.problems[0]).toMatch(/^Refused/);
    const props = drafter.sheets[0]!.inputProps as DraftSheetProps;
    expect(props.drafts[0]!.variants[1]).toMatchObject({ shapes: null });
    expect(() =>
      t.db.transaction((tx) => approveDraft(tx, t.dataDir, 'example_thread', { variant: 2 })),
    ).toThrow(InvalidEditError);
  });

  it('fails the draft (not a run) when no variant passes', async () => {
    const { job } = start();
    const bad = draftAnswer([HEX_SVG, SCRIPT_SVG, HEX_SVG]);
    await draftRunner(t.db, t.dataDir, [bad, bad, bad]).next();
    const detail = assetDetail(t.db, t.dataDir, 'example_thread');
    expect(detail.state).toBe('failed');
    expect(detail.row.error).toMatch(/^No variant of round 1 passed the sanitizer/);
    expect(getJob(t.db, job.id)?.status).toBe('done');
  });

  it('draws a round once: a job delivered again calls nothing', async () => {
    const { job } = start();
    await draftRunner(t.db, t.dataDir, [draftAnswer()]).next();
    t.db.$client.prepare("update jobs set status = 'queued' where id = ?").run(job.id);
    await draftRunner(t.db, t.dataDir, []).next();
    expect(getJob(t.db, job.id)?.status).toBe('done');
    expect(drafterPrompts()).toHaveLength(1);
    expect(assetRow(t.db, 'example_thread')!.variants).toHaveLength(3);
  });
});

describe('reviewing a draft', () => {
  async function drafted() {
    start();
    await draftRunner(t.db, t.dataDir, [draftAnswer()]).next();
  }

  it('approves one variant into the library: a render resolves it by id', async () => {
    await drafted();
    const spec = structuredClone(fixtureGeneratedSpec('rate-limiter'));
    const use = specAssetUses(spec).find((u) => u.path.at(-1) === 'icon')!;
    let node: unknown = spec;
    for (const key of use.path.slice(0, -1)) node = (node as Record<PropertyKey, unknown>)[key];
    (node as Record<string, unknown>).icon = 'example_thread';
    const missing = () => prepareRenderAssets(t.db, t.dataDir, 1, spec).missing.map((m) => m.id);
    expect(missing()).toEqual(['example_thread']);

    const row = t.db.transaction((tx) =>
      approveDraft(tx, t.dataDir, 'example_thread', { variant: 2, tags: ['thread', 'worker'] }),
    );
    expect(row).toMatchObject({
      status: 'approved',
      svgPath: 'assets/example_thread.svg',
      approvedVariant: 2,
      licence: 'LicenseRef-own',
      source: 'drafted:asset@v1',
      tags: ['thread', 'worker'],
    });
    expect(row.notes).toMatchObject([{ kind: 'approve', round: 1 }]);
    expect(missing()).toEqual([]);
    const resolved = prepareRenderAssets(t.db, t.dataDir, 1, spec).assets.find(
      (a) => a.id === 'example_thread',
    );
    const variant = parseHouseSvg(readDataText(t.dataDir, row.variants[1]!.svgPath!));
    expect(resolved).toMatchObject({ kind: 'library', shapes: variant.ok ? variant.shapes : [] });
  });

  it('regenerates with the note as feedback: a new round, numbered on', async () => {
    await drafted();
    const { job } = t.db.transaction((tx) =>
      regenerateDraft(tx, 'example_thread', 'Draw the thread as a needle and thread.'),
    );
    expect(job.payload).toEqual({ assetId: 'example_thread', round: 2 });
    expect(assetDetail(t.db, t.dataDir, 'example_thread').state).toBe('queued');
    expect(() =>
      t.db.transaction((tx) => approveDraft(tx, t.dataDir, 'example_thread', { variant: 1 })),
    ).toThrow(ConflictError);

    const drafter = draftRunner(t.db, t.dataDir, [draftAnswer()]);
    await drafter.next();
    const row = assetRow(t.db, 'example_thread')!;
    expect(row.variants.map((v) => `${v.round}:${v.number}`)).toEqual([
      '1:1',
      '1:2',
      '1:3',
      '2:4',
      '2:5',
      '2:6',
    ]);
    const prompt = drafterPrompts()[1]!;
    expect(prompt).toContain('FEEDBACK (round 2');
    expect(prompt).toContain(`- v1: ${CONCEPTS[0]}`);
    expect(prompt).toContain('Draw the thread as a needle and thread.');
    expect(drafter.sheets[0]?.outPath).toMatch(/sheet-2\.png$/);
  });

  it('rejects with a note; a rejected draft can be drawn again, never approved', async () => {
    await drafted();
    const row = t.db.transaction((tx) => rejectDraft(tx, 'example_thread', 'Too busy at 32 px.'));
    expect(row).toMatchObject({ status: 'rejected', notes: [{ kind: 'reject' }] });
    expect(() =>
      t.db.transaction((tx) => approveDraft(tx, t.dataDir, 'example_thread', { variant: 1 })),
    ).toThrow(ConflictError);
    const { row: again } = t.db.transaction((tx) =>
      regenerateDraft(tx, 'example_thread', 'Simpler.'),
    );
    expect(again.status).toBe('draft');
  });

  it('refuses a draft for an id the library has, or an alias of one', () => {
    expect(() => start({ ...REQUEST, id: 'server' })).toThrow(/already exists \(approved\)/);
    t.db.$client.prepare(`update assets set aliases = '["rack"]' where id = 'server'`).run();
    expect(() => start({ ...REQUEST, id: 'rack' })).toThrow(/alias of server/);
    expect(() => start({ ...REQUEST, family: 'nope' })).toThrow(InvalidEditError);
    expect(listJobsByStatus(t.db, 'queued')).toEqual([]);
  });
});
