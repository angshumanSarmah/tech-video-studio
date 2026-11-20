/**
 * Helpers shared by the agent fixture scripts (`director:fixture`, `scriptwriter:fixture`): run
 * one job, print the run's log and each LLM attempt with the issues its repair listed, and record
 * a role's responses as the dry-run fixture its job test replays.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExplanationLevelSchema,
  type ExplanationLevel,
  type ModelRole,
} from '@explainer-studio/shared';
import { readDataJson, resolveDataPath } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls, type LlmCallRow } from '#core/db/repositories/llm-calls.ts';
import type { JobRegistry } from '#worker/jobs/registry.ts';
import type { DryRunResponse } from '#worker/llm/index.ts';
import { runNextJob } from '#worker/runner.ts';

/** Runs the next queued job; true when `jobId` ended done (else its error is printed). */
export async function runJob(
  db: Db,
  registry: JobRegistry,
  jobId: number,
  workerId: string,
): Promise<boolean> {
  await runNextJob({ db, registry, workerId, signal: new AbortController().signal });
  const job = getJob(db, jobId);
  if (job?.status === 'done') return true;
  console.error(`  ${job?.type ?? 'job'} ${job?.status ?? 'missing'}: ${job?.error ?? ''}`);
  return false;
}

export function printLog(db: Db, runId: number): void {
  for (const event of listEventsSince(db, { runId, afterId: 0, limit: 1_000 })) {
    if (event.type !== 'log') continue;
    const { level, message } = event.payload as { level: string; message: string };
    console.log(`  [${level}] ${message}`);
  }
}

export function roleCalls(db: Db, runId: number, role: ModelRole): LlmCallRow[] {
  return listRunLlmCalls(db, runId).filter((call) => call.role === role);
}

export function callsCostUsd(calls: readonly LlmCallRow[]): number {
  return calls.reduce((sum, c) => sum + c.costUsd, 0);
}

/** Each failed attempt's issues, as the next attempt's repair message lists them. */
export function printAttempts(dataDir: string, calls: readonly LlmCallRow[]): void {
  calls.forEach((call, i) => {
    const tokens = `${call.tokensInCached} cached + ${call.tokensInUncached} uncached in, ${call.tokensOut} out`;
    console.log(
      `  attempt ${i + 1}: ${call.error ?? 'passed'} (${tokens}, $${call.costUsd.toFixed(4)})`,
    );
    const next = calls[i + 1];
    if (!call.error || !next) return;
    const prompt = readDataJson(dataDir, next.promptPath) as { messages: { content: string }[] };
    const issues = (prompt.messages.at(-1)?.content ?? '')
      .split('\n')
      .filter((l) => l.startsWith('- '));
    for (const issue of issues) console.log(`    ${issue}`);
  });
}

/** The response file the LLM client writes next to each call's prompt. */
interface RecordedResponseFile {
  readonly content: string | null;
  readonly servedModel: string | null;
  readonly finishReason: string | null;
  readonly usage: DryRunResponse['usage'];
}

/**
 * Writes the calls' responses, in call order, to `<dir>/<role>.json` as `loadDryRunFixtures`
 * reads them. Returns how many were written.
 */
export function recordResponses(
  dataDir: string,
  calls: readonly LlmCallRow[],
  dir: string,
  role: ModelRole,
): number {
  const responses: DryRunResponse[] = calls
    .filter((call) => call.responsePath)
    .map((call) => {
      const file = JSON.parse(
        readFileSync(resolveDataPath(dataDir, call.responsePath!), 'utf8'),
      ) as RecordedResponseFile;
      // Reasoning text is left out: replay never reads it, and it is large.
      return {
        content: file.content,
        servedModel: file.servedModel ?? 'recorded',
        finishReason: file.finishReason ?? 'stop',
        usage: file.usage ?? null,
      };
    });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${role}.json`), `${JSON.stringify(responses, null, 2)}\n`);
  return responses.length;
}

/** `--level <level>`, validated; undefined when not given. */
export function levelArg(argv: readonly string[]): ExplanationLevel | undefined {
  const i = argv.indexOf('--level');
  return i < 0 ? undefined : ExplanationLevelSchema.parse(argv[i + 1]);
}
