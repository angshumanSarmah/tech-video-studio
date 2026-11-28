import {
  buildAssetRegistry,
  parseHouseSvg,
  rankAssets,
  SEED_ASSETS,
  serializeHouseSvg,
  type AssetRegistry,
  type DraftSheetEntry,
} from '@explainer-studio/renderer/catalog';
import { DEFAULT_THEME_ID } from '@explainer-studio/renderer/theme';
import {
  AssetDraftOutputSchema,
  DEFAULT_VIDEO_SETTINGS,
  LibraryAssetIdSchema,
  type AssetDraftVariant,
  type LibraryAsset,
} from '@explainer-studio/shared';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { loadAssetLibrary } from '#core/assets/library.ts';
import {
  assetDraftSheetPath,
  assetDraftVariantPath,
  readDataText,
  resolveDataPath,
  writeDataText,
} from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { llmCallModel } from '#core/db/repositories/llm-calls.ts';
import { assets } from '#core/db/schema.ts';
import { NotFoundError } from '#core/errors.ts';
import {
  assetRow,
  DRAFT_ASSET_JOB_TYPE,
  draftRequestContext,
  nextVariantNumber,
  type AssetRow,
} from '#core/services/asset-drafts.ts';
import { eq } from 'drizzle-orm';
import { assetDraftCheck, judgeVariants, shapeKey } from '../agents/asset/check.ts';
import { houseStyleText } from '../agents/asset/house-style.ts';
import {
  assetCatalogue,
  assetUserMessage,
  type AssetExample,
  type AssetFeedback,
} from '../agents/asset/input.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import type { LlmClient } from '../llm/client.ts';
import { withSession } from '../render/engine.ts';
import type { RenderTools } from '../render/target.ts';
import { defineJobHandler, type JobContext } from './handler.ts';

export interface DraftAssetJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  readonly tools: RenderTools;
}

const PayloadSchema = z.strictObject({
  assetId: LibraryAssetIdSchema,
  round: z.number().int().min(1),
  requestedByRunId: z.number().int().positive().optional(),
});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/** Style examples the drafter gets: the closest of its family, then a core seed of it. */
export const MAX_ASSET_EXAMPLES = 3;
const CLOSEST_EXAMPLES = 2;

/**
 * The Asset drafter (P1C.12 A4): one round of three variants for a draft row, each through the
 * sanitizer (draft mode) in the call's check, so failing variants are repaired; the last
 * attempt's failures are kept with their problems. Passing variants are written under
 * `assets/drafts/<id>/`, then the round's preview sheet is rendered (each variant at 32, 64 and
 * 160 px, in a `node_card` and as an `item_icon`). Belongs to no run (`run_id` null, outside every
 * run's cost cap; `failsRun: false`). Idempotent per round: a round whose variants exist is not
 * drawn again (only its sheet is rendered if missing). A row no longer a draft is left alone.
 * Never approves anything.
 */
export function draftAssetJobHandler(deps: DraftAssetJobDeps) {
  return defineJobHandler({
    type: DRAFT_ASSET_JOB_TYPE,
    description: 'Draws a draft asset: three variants and their preview sheet.',
    payloadSchema: PayloadSchema,
    failsRun: false,
    run: (ctx) => draftAsset(deps, ctx),
  });
}

async function draftAsset(deps: DraftAssetJobDeps, ctx: Ctx): Promise<void> {
  const { assetId, round } = ctx.payload;
  const row = assetRow(deps.db, assetId);
  if (!row) throw new NotFoundError('Asset', assetId);
  if (row.status !== 'draft') {
    ctx.log('info', `Asset ${assetId} is ${row.status}: nothing to draft.`);
    return;
  }
  const drawn = row.variants.some((v) => v.round === round) ? row : await drawRound(deps, ctx, row);
  await renderSheet(deps, ctx, drawn, round);
  ctx.log('info', roundSummary(drawn, round));
}

async function drawRound(deps: DraftAssetJobDeps, ctx: Ctx, row: AssetRow): Promise<AssetRow> {
  const { round } = ctx.payload;
  const library = loadAssetLibrary(deps.db, deps.dataDir).assets;
  const known = new Map(library.map((a) => [shapeKey(a.shapes), `approved asset ${a.id}`]));
  const prompt = buildPrompt(deps.prompts, {
    role: 'asset',
    variables: DEFAULT_VIDEO_SETTINGS,
    catalogue: assetCatalogue(houseStyleText()),
    input: assetUserMessage(
      { ...requestOf(row), ...draftRequestContext(deps.db, deps.dataDir, row.id) },
      draftExamples(row, buildAssetRegistry(library)),
      round > 1 ? feedbackFor(row, round) : undefined,
    ),
  });
  try {
    const result = await deps.llm.callJson({
      role: 'asset',
      prompt,
      schema: AssetDraftOutputSchema,
      check: assetDraftCheck(known),
      signal: ctx.signal,
      log: ctx.log,
    });
    const model = llmCallModel(deps.db, result.callIds.at(-1) ?? 0) ?? 'unknown';
    const variants = saveVariants(deps.dataDir, row, round, result.value.variants, known, {
      model,
      prompt: prompt.versions.role,
      callIds: [...result.callIds],
    });
    return updateDraft(deps.db, row.id, {
      variants: [...row.variants, ...variants],
      error: variants.some((v) => v.svgPath) ? null : noneMessage(round, variants),
    });
  } catch (error) {
    if (!ctx.signal.aborted) {
      updateDraft(deps.db, row.id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

/** The round's variants, judged again as the check did; passing ones written to disk. */
function saveVariants(
  dataDir: string,
  row: AssetRow,
  round: number,
  answers: readonly { concept: string; svg: string }[],
  known: ReadonlyMap<string, string>,
  meta: Pick<AssetDraftVariant, 'model' | 'prompt' | 'callIds'>,
): AssetDraftVariant[] {
  const first = nextVariantNumber(row);
  const verdicts = judgeVariants(
    answers.map((a) => a.svg),
    known,
  );
  return answers.map((answer, i) => {
    const number = first + i;
    const verdict = verdicts[i]!;
    const svgPath = verdict.ok
      ? writeDataText(dataDir, assetDraftVariantPath(row.id, round, number), verdict.svg)
      : null;
    return {
      number,
      round,
      concept: answer.concept,
      svgPath,
      problems: verdict.ok ? [] : verdict.problems,
      ...meta,
    };
  });
}

function noneMessage(round: number, variants: readonly AssetDraftVariant[]): string {
  const first = variants.flatMap((v) => v.problems.slice(0, 1));
  return `No variant of round ${round} passed the sanitizer: ${first.join(' | ')}`;
}

function updateDraft(db: Db, id: string, set: Partial<typeof assets.$inferInsert>): AssetRow {
  const row = db
    .update(assets)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning()
    .get();
  if (!row) throw new NotFoundError('Asset', id);
  return row;
}

function requestOf(row: AssetRow) {
  return {
    id: row.id,
    name: row.name,
    family: row.family,
    description: row.description ?? row.name,
  };
}

/**
 * Style examples (P1C.12): the approved assets of the draft's family that rank closest to it,
 * then the family's core seed assets (curated), at most `MAX_ASSET_EXAMPLES`; a family with too
 * few falls back to the closest of any family. Deterministic.
 */
export function draftExamples(row: AssetRow, registry: AssetRegistry): AssetExample[] {
  const query = { id: row.id, name: row.name, description: row.description ?? undefined };
  const inFamily = (a: LibraryAsset) => a.family === row.family;
  const ranked = rankAssets(query, registry, { family: row.family })
    .map((r) => registry.get(r.id))
    .filter((a): a is LibraryAsset => a !== undefined);
  const core = SEED_ASSETS.filter(inFamily).flatMap((a) => registry.get(a.id) ?? []);
  const picked = [
    ...ranked.filter(inFamily).slice(0, CLOSEST_EXAMPLES),
    ...core,
    ...ranked,
    ...[...registry.values()].filter(inFamily),
  ];
  const unique = [...new Map(picked.map((a) => [a.id, a])).values()].slice(0, MAX_ASSET_EXAMPLES);
  return unique.map((a) => ({
    id: a.id,
    name: a.name,
    family: a.family,
    svg: serializeHouseSvg(a.shapes),
  }));
}

/** A later round's feedback: every earlier variant's idea, and the notes since the last round. */
export function feedbackFor(
  row: Pick<AssetRow, 'variants' | 'notes'>,
  round: number,
): AssetFeedback {
  return {
    round,
    earlier: row.variants.map((v) => ({ number: v.number, concept: v.concept })),
    notes: row.notes
      .filter((n) => n.kind !== 'approve' && n.round === round - 1 && n.text !== '')
      .map((n) => n.text),
  };
}

async function renderSheet(
  deps: DraftAssetJobDeps,
  ctx: Ctx,
  row: AssetRow,
  round: number,
): Promise<void> {
  const outPath = resolveDataPath(deps.dataDir, assetDraftSheetPath(row.id, round));
  if (existsSync(outPath)) return;
  const entry = draftSheetEntry(row, round, (path) => readDataText(deps.dataDir, path));
  await withSession(deps.tools.engine, (session) =>
    session.renderSheet({
      compositionId: 'AssetDraftSheet',
      inputProps: { themeId: DEFAULT_THEME_ID, title: `Draft: ${row.name}`, drafts: [entry] },
      outPath,
      signal: ctx.signal,
    }),
  );
}

/** One round of a draft as the preview sheet draws it (refused variants with their problems). */
export function draftSheetEntry(
  row: AssetRow,
  round: number,
  readSvg: (path: string) => string,
  caption?: string,
): DraftSheetEntry {
  const variants = row.variants.filter((v) => v.round === round);
  const passed = variants.filter((v) => v.svgPath).length;
  const model = variants[0]?.model ?? 'no model';
  return {
    id: row.id,
    name: row.name,
    family: row.family,
    description: row.description ?? '',
    caption:
      caption ?? `round ${round} · ${model} · ${passed} of ${variants.length} passed the sanitizer`,
    variants: variants.map((v) => {
      const parsed = v.svgPath ? parseHouseSvg(readSvg(v.svgPath)) : null;
      return {
        number: v.number,
        concept: v.concept,
        shapes: parsed?.ok ? parsed.shapes : null,
        problems: parsed && !parsed.ok ? parsed.problems : v.problems,
      };
    }),
  };
}

function roundSummary(row: AssetRow, round: number): string {
  const variants = row.variants.filter((v) => v.round === round);
  const passed = variants.filter((v) => v.svgPath).map((v) => `v${v.number}`);
  const refused = variants.filter((v) => !v.svgPath);
  const head = `Asset ${row.id} round ${round}: ${passed.length} of ${variants.length} variants passed`;
  const tail = refused.map((v) => `v${v.number} refused: ${v.problems[0] ?? ''}`);
  const sheet = assetDraftSheetPath(row.id, round);
  return [
    `${head}${passed.length > 0 ? ` (${passed.join(', ')})` : ''}.`,
    ...tail,
    `Sheet: ${sheet}`,
  ].join('\n');
}
