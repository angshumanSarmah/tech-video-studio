/**
 * `pnpm --filter @explainer-studio/studio assets:draft-fixture [--models flash,pro] [--timeout <sec>]`
 * [--sheets-only] (P1C.12 A4): the Asset drafter live on six test requests (thread, connection, slow command,
 * cache hit, event loop, write-ahead log), once per model, each through the real `draft_asset`
 * job (sanitizer check, repairs, preview sheet) in its own scratch data dir with the full library
 * seeded: `<DATA_DIR>/asset-drafts/fixture/<model>/`. Nothing is approved, and nothing reaches the
 * main library. Prints per draft each variant's verdict, the attempts and the cost; per model the
 * variants that passed the sanitizer on the first attempt and in the end, and the cost. Writes one
 * sheet per model (every draft, each variant at 32, 64 and 160 px, in a `node_card` and as an
 * `item_icon`) and the models side by side, to `<DATA_DIR>/sheets/`. `--sheets-only` renders
 * the sheets again from the last run's scratch dirs, calling no model.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DraftSheetEntry } from '@explainer-studio/renderer/catalog';
import { DEFAULT_THEME_ID } from '@explainer-studio/renderer/theme';
import { DEEPSEEK_MODELS, type AssetFamily } from '@explainer-studio/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { loadAssetLibrary } from '#core/assets/library.ts';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { readDataJson, readDataText } from '#core/data-files.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { llmCalls } from '#core/db/schema.ts';
import { assetRow, createDraft, slugOf } from '#core/services/asset-drafts.ts';
import { judgeVariants, shapeKey } from '#worker/agents/asset/check.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { draftAssetJobHandler, draftSheetEntry } from '#worker/jobs/draft-asset.ts';
import { createJobRegistry } from '#worker/jobs/registry.ts';
import { createLlmClient, createLlmTransport } from '#worker/llm/index.ts';
import { withSession } from '#worker/render/engine.ts';
import { runFfmpeg } from '#worker/render/ffmpeg.ts';
import { createRemotionEngine } from '#worker/render/remotion-engine.ts';
import type { RenderTools } from '#worker/render/target.ts';
import { printAttempts, runJob } from './agent-fixture.ts';

/** The six requests (invented wording) the plan judges drafting by. */
export const TEST_REQUESTS: readonly {
  name: string;
  family: AssetFamily;
  description: string;
}[] = [
  {
    name: 'Thread',
    family: 'dev',
    description: 'One thread of execution: a single line of work that a process runs.',
  },
  {
    name: 'Connection',
    family: 'network',
    description: 'An open client connection to a server: a link that stays open between them.',
  },
  {
    name: 'Slow command',
    family: 'time',
    description: 'A command that takes a long time to run and holds up the ones behind it.',
  },
  {
    name: 'Cache hit',
    family: 'data',
    description: 'A read answered from the cache: found in fast memory, no trip to the store.',
  },
  {
    name: 'Event loop',
    family: 'dev',
    description: 'One loop that takes events from a queue and handles them one at a time.',
  },
  {
    name: 'Write-ahead log',
    family: 'data',
    description: 'A log that every change is appended to before it is applied to the data.',
  },
];

const MODEL_NAMES: Readonly<Record<string, string>> = {
  flash: DEEPSEEK_MODELS.v41Flash,
  pro: DEEPSEEK_MODELS.v4Pro,
};

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

type ModelResult = {
  model: string;
  sheet: string;
  entries: DraftSheetEntry[];
  firstPassed: number;
  passed: number;
  total: number;
  cost: number;
  calls: number;
};

function assetCalls(db: Db) {
  return db
    .select()
    .from(llmCalls)
    .where(and(isNull(llmCalls.runId), eq(llmCalls.role, 'asset')))
    .orderBy(asc(llmCalls.id))
    .all();
}

/** Variants that passed on each draft's first attempt (attempt 0: before any repair turn). */
function firstAttemptPasses(db: Db, dataDir: string): number {
  return assetCalls(db)
    .filter((c) => c.attempt === 0 && c.responsePath)
    .reduce((n, c) => n + passingInAnswer(db, dataDir, c.responsePath!), 0);
}

/** Variants of a call's answer the sanitizer passes (the first attempt, before any repair). */
function passingInAnswer(db: Db, dataDir: string, responsePath: string): number {
  const response = readDataJson(dataDir, responsePath) as { content?: string | null };
  const library = loadAssetLibrary(db, dataDir).assets;
  const known = new Map(library.map((a) => [shapeKey(a.shapes), a.id]));
  return judgeVariants(answerSvgs(response.content ?? ''), known).filter((v) => v.ok).length;
}

function answerSvgs(content: string): string[] {
  try {
    const value = JSON.parse(content) as { variants?: { svg?: unknown }[] };
    return (value.variants ?? []).map((v) => (typeof v.svg === 'string' ? v.svg : ''));
  } catch {
    return [];
  }
}

/** Drafts the six requests with one model, printing each draft's attempts and variants. */
async function draftAll(
  db: Db,
  dataDir: string,
  config: AppConfig,
  model: string,
  tools: RenderTools,
): Promise<void> {
  const llmSettings = { ...config.llm, models: { ...config.llm.models, asset: model } };
  const llm = createLlmClient({
    db,
    dataDir,
    llm: llmSettings,
    transport: createLlmTransport(config.llm),
  });
  const prompts = loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR));
  const registry = createJobRegistry([draftAssetJobHandler({ db, dataDir, llm, prompts, tools })]);
  for (const request of TEST_REQUESTS) {
    const { row, job } = db.transaction((tx) => createDraft(tx, request));
    const before = assetCalls(db).length;
    console.log(`\n${row.id} (${row.family}): ${row.description ?? ''}`);
    await runJob(db, registry, job.id, 'asset-draft-fixture');
    printAttempts(dataDir, assetCalls(db).slice(before));
    for (const v of assetRow(db, row.id)?.variants ?? []) {
      console.log(`  v${v.number} ${v.svgPath ? 'ok' : 'REFUSED'}: ${v.concept}`);
      for (const p of v.problems) console.log(`      ${p}`);
    }
  }
}

/** One model's drafts (fresh, or the last run's with `sheetsOnly`), its sheet and its counts. */
async function modelResult(
  config: AppConfig,
  model: string,
  tools: RenderTools,
  sheetsOnly: boolean,
): Promise<ModelResult> {
  const dataDir = join(config.dataDir, 'asset-drafts', 'fixture', model);
  if (!sheetsOnly) rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    console.log(`\n=== ${model} ===`);
    if (!sheetsOnly) await draftAll(db, dataDir, config, model, tools);
    const rows = TEST_REQUESTS.map((r) => assetRow(db, slugOf(r.name))!);
    const entries = rows.map((r) => draftSheetEntry(r, 1, (p) => readDataText(dataDir, p)));
    const variants = rows.flatMap((r) => r.variants);
    const calls = assetCalls(db);
    const sheet = join(config.dataDir, 'sheets', `asset-drafts-${model}.png`);
    await renderDraftSheet(tools, sheet, { title: `Asset drafts · ${model}`, drafts: entries });
    return {
      model,
      sheet,
      entries,
      firstPassed: firstAttemptPasses(db, dataDir),
      passed: variants.filter((v) => v.svgPath).length,
      total: variants.length,
      cost: calls.reduce((sum, c) => sum + c.costUsd, 0),
      calls: calls.length,
    };
  } finally {
    closeDatabase(db);
  }
}

type SheetInput = {
  title: string;
  drafts: DraftSheetEntry[];
  columns?: { title: string; drafts: DraftSheetEntry[] }[];
};

function renderDraftSheet(tools: RenderTools, outPath: string, props: SheetInput): Promise<void> {
  return withSession(tools.engine, (session) =>
    session.renderSheet({
      compositionId: 'AssetDraftSheet',
      inputProps: { themeId: DEFAULT_THEME_ID, ...props },
      outPath,
      signal: new AbortController().signal,
    }),
  );
}

async function main(): Promise<number> {
  const base = loadConfig();
  const timeout = Number(arg('--timeout'));
  const config =
    Number.isFinite(timeout) && timeout > 0
      ? { ...base, llm: { ...base.llm, requestTimeoutSec: timeout } }
      : base;
  const models = (arg('--models') ?? 'flash,pro').split(',').map((m) => MODEL_NAMES[m] ?? m);
  const sheetsOnly = process.argv.includes('--sheets-only');
  const tools: RenderTools = {
    engine: createRemotionEngine(),
    ffmpeg: runFfmpeg,
    settings: config.render,
  };
  const results: ModelResult[] = [];
  for (const model of models) results.push(await modelResult(config, model, tools, sheetsOnly));

  console.log('\nmodel                 first attempt   after repairs   calls   cost');
  for (const r of results) {
    console.log(
      `${r.model.padEnd(21)} ${`${r.firstPassed}/${r.total}`.padEnd(15)} ${`${r.passed}/${r.total}`.padEnd(15)} ${String(r.calls).padEnd(7)} $${r.cost.toFixed(4)}`,
    );
  }
  for (const r of results) {
    console.log(`sheet ${r.model}: ${relative(config.workspaceRoot, r.sheet)}`);
  }
  if (results.length > 1) {
    const out = join(config.dataDir, 'sheets', 'asset-drafts-compare.png');
    await renderDraftSheet(tools, out, {
      title: 'Asset drafts',
      drafts: [],
      columns: results.map((r) => ({ title: r.model, drafts: r.entries })),
    });
    console.log(`side by side: ${relative(config.workspaceRoot, out)}`);
  }
  return 0;
}

process.exitCode = await main();
