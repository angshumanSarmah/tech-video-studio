/**
 * `pnpm --filter @explainer-studio/studio curator:fixture [--topic <topic>] [--seeded <id>]
 * [--replay] [--record] [--timeout <sec>]`: runs the Curator (code checks, then the review) on a fixture topic's
 * finished spec: the recorded plan, script and boards with the committed timing, or that spec
 * with one seeded fault (`--seeded <id>`, which picks its topic; ids in
 * `agents/curator/fixtures.ts`). The Researcher and Director replay their recordings (the run
 * needs their steps); the Curator calls the configured model (needs DEEPSEEK_API_KEY), or with
 * `--replay` its recording. Runs in a scratch data dir with its own database:
 * <DATA_DIR>/curator/fixture/<topic>[-<seed>]/ (wiped first).
 *
 * Prints each review attempt with the issues its repair listed, the code findings, every review
 * issue (beat, category, severity, owner, evidence, fix), the issues code dropped and why, cost
 * and tokens, then the eval: must-find found or missed, may-find found, must-not-flag lines
 * flagged; for a seed, whether it was caught. `--record` keeps the Curator's answers (every
 * attempt) and the eval (`eval.json`) next to them, which `jobs/curate.test.ts` replays.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { CodeIssue, CuratorIssue, CuratorReport, Evidence } from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { latestCuration } from '#core/services/curation.ts';
import {
  CURATOR_SEEDS,
  curatorSeed,
  evalPath,
  evaluateTopic,
  seedCatcher,
  seededSpec,
  TOPIC_EXPECTATIONS,
  type CuratorSeed,
} from '#worker/agents/curator/fixtures.ts';
import {
  curatorResponsesDir,
  queueFixtureCurate,
  recordedChain,
} from '#worker/agents/curator/testing.ts';
import { fixtureTopic, type FixtureTopic } from '#worker/agents/fixture-topics.ts';
import { fixtureGeneratedSpec } from '#worker/agents/generator/testing.ts';
import { NO_TTS } from '#worker/repair/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { curateJobHandler } from '#worker/jobs/curate.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  type LlmTransport,
} from '#worker/llm/index.ts';
import {
  printAttempts,
  printLog,
  recordResponses,
  roleCalls,
  runJob as runAgentJob,
  seedFixtureRun,
  topicArg,
} from './agent-fixture.ts';

const runJob = (db: Db, registry: JobRegistry, jobId: number) =>
  runAgentJob(db, registry, jobId, 'curator-fixture');

function seedArg(argv: readonly string[]): CuratorSeed | undefined {
  const i = argv.indexOf('--seeded');
  if (i < 0) return undefined;
  const id = argv[i + 1];
  if (!id) throw new Error(`--seeded needs one of ${CURATOR_SEEDS.map((s) => s.id).join(', ')}`);
  return curatorSeed(id);
}

/** Researcher and Director replayed; the Curator live, or replayed with `--replay`. */
function transportFor(
  config: AppConfig,
  topic: FixtureTopic,
  seed: CuratorSeed | undefined,
  replay: boolean,
): LlmTransport {
  const recorded = dryRunTransport(recordedChain(topic.id, curatorResponsesDir(topic.id, seed)));
  if (replay) return recorded;
  const live = createLlmTransport(config.llm);
  return { send: (req) => (req.role === 'curator' ? live : recorded).send(req) };
}

function registryFor(config: AppConfig, db: Db, dataDir: string, transport: LlmTransport) {
  const llm = createLlmClient({ db, dataDir, llm: config.llm, transport });
  const deps = {
    db,
    dataDir,
    llm,
    prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
    settings: {
      video: config.video,
      research: config.research,
      timing: config.timing,
      tts: config.tts,
      llm: config.llm,
    },
    // Review only (`repair: false`): nothing is narrated.
    tts: NO_TTS,
  };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    curateJobHandler(deps),
  ]);
}

const quoted = (text: string) => `"${text}"`;

function evidenceText(e: Evidence): string {
  if (e.kind === 'label') return `label ${e.elementId} ${quoted(e.quote)}`;
  if (e.kind === 'fact') return e.quote ? `${e.id} ${quoted(e.quote)}` : e.id;
  if (e.kind === 'number') return e.id;
  return `${e.kind} ${quoted(e.quote)}`;
}

function printIssue(issue: CuratorIssue, indent = '    '): void {
  console.log(
    `${indent}${issue.beatId} ${issue.category} [${issue.severity}, ${issue.owner}: ${issue.fields.join(', ')}]`,
  );
  console.log(`${indent}  problem: ${issue.problem}`);
  for (const e of issue.evidence) console.log(`${indent}  evidence: ${evidenceText(e)}`);
  console.log(`${indent}  fix: ${issue.fix}`);
}

function printCode(issues: readonly CodeIssue[]): void {
  console.log(`\n  code findings (${issues.length}):`);
  for (const i of issues) console.log(`    ${i.path} ${i.code} [${i.severity}, ${i.owner}]`);
}

function printReport(report: CuratorReport): void {
  printCode(report.codeIssues);
  const review = report.review;
  if (!review) return console.log('\n  review: none (invalid spec)');
  console.log(`\n  review issues (${review.issues.length}; ${review.capped} capped):`);
  for (const issue of review.issues) printIssue(issue);
  console.log(`\n  dropped (${review.dropped.length}):`);
  for (const d of review.dropped) {
    printIssue(d.issue);
    console.log(`      dropped: ${d.why}`);
    for (const r of d.reasons) console.log(`        ${r.path} ${r.code}: ${r.message}`);
  }
  console.log(
    `\n  claims audited: ${review.claims.length}; coverage repairs ${review.coverage.repairs}; ` +
      `calls claims ${review.calls.claims}, story ${review.calls.story}`,
  );
  for (const m of review.coverage.missing) console.log(`    still missing: ${m}`);
  const verdicts = new Map<string, number>();
  for (const c of review.claims) verdicts.set(c.verdict, (verdicts.get(c.verdict) ?? 0) + 1);
  console.log(`  verdicts: ${[...verdicts].map(([v, n]) => `${v} ${n}`).join(', ')}`);
  const u = review.usage;
  console.log(
    `\n  usage: ${u.calls} call(s), $${u.costUsd.toFixed(4)}; input ${u.inCached} cached + ` +
      `${u.inUncached} uncached, output ${u.out} (${u.reasoning} reasoning)`,
  );
  console.log(`  blocking: ${report.blocking ? 'yes' : 'no'}`);
}

/** The eval printed and returned (what `eval.json` records). */
function evaluate(topic: FixtureTopic, seed: CuratorSeed | undefined, report: CuratorReport) {
  const issues = report.review?.issues ?? [];
  if (seed) {
    const spec = seededSpec(fixtureGeneratedSpec(seed.topic), seed);
    const by = seedCatcher(issues, report.codeIssues, spec, seed);
    console.log(`\n  seed ${seed.id} (${seed.category}): ${by ? `CAUGHT by ${by}` : 'MISSED'}`);
    console.log(`    ${seed.what}`);
    return { seed: seed.id, caught: by !== null, by };
  }
  const result = evaluateTopic(issues, TOPIC_EXPECTATIONS[topic.id]);
  console.log(`\n  must-find found: ${result.found.join(', ') || 'none'}`);
  console.log(`  must-find missed: ${result.missed.join(', ') || 'none'}`);
  console.log(`  may-find found: ${result.mayFound.join(', ') || 'none'}`);
  console.log(`  must-not-flag flagged: ${result.flagged.join('; ') || 'none'}`);
  return result;
}

function record(db: Db, dataDir: string, runId: number, dir: string, result: unknown): void {
  mkdirSync(dir, { recursive: true });
  const n = recordResponses(dataDir, roleCalls(db, runId, 'curator'), dir, 'curator');
  writeFileSync(evalPath(dir), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`  recorded ${n} response(s) and the eval -> ${dir}`);
}

/**
 * `--timeout <sec>`: a longer per-request limit for this run only (the review's reasoning can
 * run past the default `llm.requestTimeoutSec` when the provider is slow).
 */
function withTimeout(config: AppConfig, argv: readonly string[]): AppConfig {
  const i = argv.indexOf('--timeout');
  if (i < 0) return config;
  const sec = Number(argv[i + 1]);
  if (!Number.isInteger(sec) || sec < 10 || sec > 1800) {
    throw new Error(
      `--timeout needs whole seconds from 10 to 1800; got ${argv[i + 1] ?? '(none)'}`,
    );
  }
  return { ...config, llm: { ...config.llm, requestTimeoutSec: sec } };
}

async function main(): Promise<number> {
  const config = withTimeout(loadConfig(), process.argv);
  const seed = seedArg(process.argv);
  const topic = seed ? fixtureTopic(seed.topic) : topicArg(process.argv);
  const replay = process.argv.includes('--replay');
  const name = seed ? `${topic.id}-${seed.id}` : topic.id;
  const dataDir = join(config.dataDir, 'curator', 'fixture', name);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const registry = registryFor(config, db, dataDir, transportFor(config, topic, seed, replay));
    console.log(`${name}: curator ${replay ? 'replayed' : `live (${config.llm.models.curator})`}`);
    const { runId } = seedFixtureRun(db, dataDir, topic, undefined);
    let ok = await runJob(db, registry, listRunJobs(db, runId)[0]!.id);
    for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
      ok = ok && (await runJob(db, registry, enqueueJob(db, { type, runId }).id));
    }
    ok = ok && (await runJob(db, registry, queueFixtureCurate(db, dataDir, runId, topic.id, seed)));
    printLog(db, runId);
    console.log(`  curator attempts:`);
    printAttempts(dataDir, roleCalls(db, runId, 'curator'));
    console.log(`  files -> ${relative(config.workspaceRoot, dataDir)}`);
    if (!ok) return 1;
    const { report } = latestCuration(db, dataDir, runId)!;
    printReport(report);
    const result = evaluate(topic, seed, report);
    if (process.argv.includes('--record') && !replay) {
      record(db, dataDir, runId, curatorResponsesDir(topic.id, seed), result);
    }
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
