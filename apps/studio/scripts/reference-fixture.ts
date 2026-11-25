/**
 * `pnpm --filter @explainer-studio/studio reference:fixture [--replay] [--record] [--timeout <sec>]`
 * (P1C.11): the Reference analyst on the six committed breakdowns in `seed/references/`, live
 * against the configured reference model (or `--replay` its recording), one `analyze_reference`
 * job per breakdown in slug order. Prints each record (class, hook, devices, patterns, unmapped
 * items, names flagged), every attempt's issues and the cost. `--record` (only when all six pass)
 * writes `seed/references/<slug>.record.json`, which seeding reads, and the answers to
 * `src/worker/agents/reference/fixtures/responses/reference.json`, which
 * `analyze-reference.test.ts` replays (run `pnpm format` after recording). Runs in a scratch data dir with its own database (no
 * seeds loaded): <DATA_DIR>/reference/fixture/.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  backlogItems,
  referencePatterns,
  referenceDevices,
  type ReferenceRecord,
} from '@explainer-studio/shared';
import { loadConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { llmCalls } from '#core/db/schema.ts';
import { SEED_REFERENCES_DIR } from '#core/services/reference-seed.ts';
import { addReference, readReferenceRecord, requireReference } from '#core/services/references.ts';
import { REFERENCE_RESPONSES_DIR } from '#worker/agents/reference/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { analyzeReferenceJobHandler } from '#worker/jobs/analyze-reference.ts';
import { createJobRegistry } from '#worker/jobs/registry.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  loadDryRunFixtures,
} from '#worker/llm/index.ts';
import { printAttempts, recordResponses, runJob } from './agent-fixture.ts';

function referenceCalls(db: Db) {
  return db
    .select()
    .from(llmCalls)
    .where(and(isNull(llmCalls.runId), eq(llmCalls.role, 'reference')))
    .orderBy(asc(llmCalls.id))
    .all();
}

function timeoutSec(): number | undefined {
  const at = process.argv.indexOf('--timeout');
  const value = at < 0 ? undefined : Number(process.argv[at + 1]);
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function printRecord(record: ReferenceRecord): void {
  console.log(
    `  ${record.title} · ${record.topicClass}${record.secondaryTopicClass ? `+${record.secondaryTopicClass}` : ''} · ${record.format} · ${record.beats.length} beats`,
  );
  console.log(`  hook ${record.hook.kind}/${record.hook.device}: ${record.hook.shape}`);
  console.log(`  arc: ${record.arc}`);
  console.log(`  devices: ${referenceDevices(record).join(', ')}`);
  console.log(`  patterns: ${referencePatterns(record).join(', ') || '-'}`);
  record.beats.forEach((b, i) => {
    const ids = [
      ...b.devices,
      ...b.patterns,
      ...b.primitives,
      ...(b.layoutMode ? [b.layoutMode] : []),
    ];
    console.log(
      `    ${i} ${b.role}${b.continuesPrevious ? ' (cont.)' : ''}: ${b.summary} [${ids.join(', ')}]`,
    );
  });
  for (const u of record.unmapped) {
    console.log(
      `  unmapped ${u.name} (${u.kind}, ${u.buildable}${u.closest ? `, closest ${u.closest}` : ''}): ${u.description}`,
    );
  }
  console.log(`  backlog items: ${backlogItems(record).length}`);
  console.log(
    `  names flagged: ${record.namesToAvoid.map((n) => `${n.text} (${n.kind})`).join(', ') || '-'}`,
  );
}

async function main(): Promise<number> {
  const base = loadConfig();
  const timeout = timeoutSec();
  const config =
    timeout === undefined ? base : { ...base, llm: { ...base.llm, requestTimeoutSec: timeout } };
  const replay = process.argv.includes('--replay');
  const dataDir = join(config.dataDir, 'reference', 'fixture');
  rmSync(dataDir, { recursive: true, force: true });
  const emptySeeds = join(dataDir, 'no-seeds');
  mkdirSync(emptySeeds, { recursive: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot), {
    seedReferencesDir: emptySeeds,
  });
  const db = openDatabase(dbPath);
  const seedDir = join(config.workspaceRoot, SEED_REFERENCES_DIR);
  const responsesDir = join(config.workspaceRoot, REFERENCE_RESPONSES_DIR);
  try {
    const transport = replay
      ? dryRunTransport(loadDryRunFixtures(responsesDir))
      : createLlmTransport(config.llm);
    const llm = createLlmClient({ db, dataDir, llm: config.llm, transport });
    const prompts = loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR));
    const registry = createJobRegistry([analyzeReferenceJobHandler({ db, dataDir, llm, prompts })]);
    console.log(
      `reference analyst ${replay ? 'replayed' : `live (${config.llm.models.reference})`}`,
    );
    const slugs = readdirSync(seedDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => f.slice(0, -3));
    const records = new Map<string, ReferenceRecord>();
    let ok = true;
    for (const slug of slugs) {
      const breakdown = readFileSync(join(seedDir, `${slug}.md`), 'utf8');
      const { job } = db.transaction((tx) => addReference(tx, dataDir, { breakdown, title: slug }));
      const before = referenceCalls(db).length;
      console.log(`\n${slug}`);
      const done = await runJob(db, registry, job.id, 'reference-fixture');
      printAttempts(dataDir, referenceCalls(db).slice(before));
      const record = readReferenceRecord(dataDir, requireReference(db, slug));
      if (done && record) {
        records.set(slug, record);
        printRecord(record);
      }
      ok = done && ok;
    }
    const calls = referenceCalls(db);
    const cost = calls.reduce((sum, c) => sum + c.costUsd, 0);
    console.log(
      `\n${records.size}/${slugs.length} ready · ${calls.length} calls · $${cost.toFixed(4)}`,
    );
    console.log(`files -> ${relative(config.workspaceRoot, dataDir)}`);
    if (process.argv.includes('--record') && !replay && ok) {
      for (const [slug, record] of records) {
        writeFileSync(join(seedDir, `${slug}.record.json`), `${JSON.stringify(record, null, 2)}\n`);
      }
      const n = recordResponses(dataDir, calls, responsesDir, 'reference');
      console.log(`recorded ${records.size} records -> ${relative(config.workspaceRoot, seedDir)}`);
      console.log(`recorded ${n} answers -> ${relative(config.workspaceRoot, responsesDir)}`);
    }
    return ok ? 0 : 1;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
