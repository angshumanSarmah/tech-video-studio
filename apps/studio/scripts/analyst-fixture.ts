/**
 * `pnpm --filter @explainer-studio/studio analyst:fixture [--replay] [--record]` (P1C.10): the
 * Analyst on the invented gate notes of `FIXTURE_NOTES` (a headline edit, a busy board, a
 * repeated opening, a one-off date, a Curator complaint), live against the configured analyst
 * model (or `--replay` its recording), one `propose_rule` job per note in order, so earlier
 * proposals are EXISTING RULES for later ones. Prints each outcome against what a good answer
 * is, the attempts and the cost. `--record` writes the answers to
 * `src/worker/agents/analyst/fixtures/responses/analyst.json`, which `propose-rule.test.ts`
 * replays. Runs in a scratch data dir with its own database: <DATA_DIR>/analyst/fixture/.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { loadConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { llmCalls } from '#core/db/schema.ts';
import { requestRuleProposal } from '#core/services/rule-proposals.ts';
import { proposalOfEvent } from '#core/services/style-rules.ts';
import {
  ANALYST_RESPONSES_DIR,
  FIXTURE_NOTES,
  seedNote,
  seedProposalRun,
  type FixtureNote,
} from '#worker/agents/analyst/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { proposeRuleJobHandler } from '#worker/jobs/propose-rule.ts';
import { createJobRegistry } from '#worker/jobs/registry.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  loadDryRunFixtures,
} from '#worker/llm/index.ts';
import { printAttempts, recordResponses, runJob } from './agent-fixture.ts';

function analystCalls(db: Db) {
  return db
    .select()
    .from(llmCalls)
    .where(and(isNull(llmCalls.runId), eq(llmCalls.role, 'analyst')))
    .orderBy(asc(llmCalls.id))
    .all();
}

function expected(note: FixtureNote): string {
  return 'scope' in note.expect ? `a ${note.expect.scope} rule` : `no rule (${note.expect.reason})`;
}

/** The job's outcome line: the proposed rule, or why there is none. */
function outcome(db: Db, eventId: number, jobId: number): { line: string; matches: string } {
  const rule = proposalOfEvent(db, eventId);
  if (rule) {
    return {
      line: `rule (${rule.scope}): ${rule.text}\n      why: ${rule.reason ?? ''}`,
      matches: `a ${rule.scope} rule`,
    };
  }
  const logs = listEventsSince(db, { jobId, afterId: 0, limit: 100 }).flatMap((e) =>
    e.type === 'log' ? [e.payload.message] : [],
  );
  const none = logs.find((l) => l.startsWith('No rule')) ?? logs.at(-1) ?? 'no outcome';
  const reason = /^No rule \((\w+)/.exec(none)?.[1] ?? '?';
  return { line: none, matches: `no rule (${reason})` };
}

async function main(): Promise<number> {
  const config = loadConfig();
  const replay = process.argv.includes('--replay');
  const dataDir = join(config.dataDir, 'analyst', 'fixture');
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  const responsesDir = join(config.workspaceRoot, ANALYST_RESPONSES_DIR);
  try {
    const transport = replay
      ? dryRunTransport(loadDryRunFixtures(responsesDir))
      : createLlmTransport(config.llm);
    const llm = createLlmClient({ db, dataDir, llm: config.llm, transport });
    const prompts = loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR));
    const registry = createJobRegistry([proposeRuleJobHandler({ db, dataDir, llm, prompts })]);
    const seeded = seedProposalRun(db, dataDir, config);
    console.log(`analyst ${replay ? 'replayed' : `live (${config.llm.models.analyst})`}`);
    let ok = true;
    let matched = 0;
    for (const note of FIXTURE_NOTES) {
      const eventId = seedNote(db, dataDir, seeded, note);
      const job = db.transaction((tx) => requestRuleProposal(tx, eventId));
      const before = analystCalls(db).length;
      console.log(`\n${note.id} (${note.gate}): "${note.note}"`);
      ok = (await runJob(db, registry, job.id, 'analyst-fixture')) && ok;
      const result = outcome(db, eventId, job.id);
      const hit = result.matches === expected(note);
      matched += hit ? 1 : 0;
      console.log(`    ${result.line}`);
      console.log(`    expected ${expected(note)}: ${hit ? 'yes' : 'NO'}`);
      printAttempts(dataDir, analystCalls(db).slice(before));
    }
    const calls = analystCalls(db);
    const cost = calls.reduce((sum, c) => sum + c.costUsd, 0);
    console.log(
      `\n${matched}/${FIXTURE_NOTES.length} as expected · ${calls.length} calls · $${cost.toFixed(4)}`,
    );
    console.log(`files -> ${relative(config.workspaceRoot, dataDir)}`);
    if (process.argv.includes('--record') && !replay && ok) {
      const n = recordResponses(dataDir, calls, responsesDir, 'analyst');
      console.log(`recorded ${n} answers -> ${relative(config.workspaceRoot, responsesDir)}`);
    }
    return ok ? 0 : 1;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
