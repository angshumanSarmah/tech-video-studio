/**
 * Helpers shared by the agent fixture scripts (`research:fixture`, `director:fixture`,
 * `scriptwriter:fixture`): pick the topic (`--topic`), seed its run, wire the chain's transport
 * (earlier roles replayed when recorded, else live), run one job, print the run's log and each
 * LLM attempt with the issues its repair listed, and record a role's responses as the dry-run
 * fixture its job test replays.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExplanationLevelSchema,
  type DirectorPlan,
  type ExplanationLevel,
  type ModelRole,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { readDataJson, resolveDataPath } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls, type LlmCallRow } from '#core/db/repositories/llm-calls.ts';
import type { AppConfig } from '#core/config.ts';
import {
  FIXTURE_ROLES,
  FIXTURE_TOPIC_IDS,
  fixtureResponsesDir,
  fixtureTopic,
  hasRecordedResponses,
  type FixtureRole,
  type FixtureTopic,
  type FixtureTopicId,
} from '#worker/agents/fixture-topics.ts';
import { seedRunWithUploads } from '#worker/agents/researcher/testing.ts';
import type { JobRegistry } from '#worker/jobs/registry.ts';
import {
  createLlmTransport,
  dryRunTransport,
  loadDryRunFixtures,
  type DryRunResponse,
  type LlmTransport,
} from '#worker/llm/index.ts';
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
  const responses = calls.filter((call) => call.responsePath).map((c) => recorded(dataDir, c));
  writeRecording(dir, role, responses);
  return responses.length;
}

/**
 * Writes the calls' responses per replay key (`{ [beatId]: DryRunResponse[] }`, each key in call
 * order, keys sorted) to `<dir>/<role>.json`, for roles whose calls run in parallel (the
 * Generator). Each call's key is read from its prompt file. Returns how many were written.
 */
export function recordKeyedResponses(
  dataDir: string,
  calls: readonly LlmCallRow[],
  dir: string,
  role: ModelRole,
): number {
  const byKey = new Map<string, DryRunResponse[]>();
  for (const call of calls.filter((c) => c.responsePath)) {
    const prompt = readDataJson(dataDir, call.promptPath) as { replayKey?: string };
    if (prompt.replayKey === undefined) throw new Error(`Call ${call.id} has no replayKey`);
    byKey.set(prompt.replayKey, [...(byKey.get(prompt.replayKey) ?? []), recorded(dataDir, call)]);
  }
  const keys = [...byKey.keys()].sort();
  writeRecording(dir, role, Object.fromEntries(keys.map((k) => [k, byKey.get(k) ?? []])));
  return [...byKey.values()].reduce((sum, list) => sum + list.length, 0);
}

/** One call's response as a replayable recording (reasoning left out: large, never replayed). */
function recorded(dataDir: string, call: LlmCallRow): DryRunResponse {
  const file = JSON.parse(
    readFileSync(resolveDataPath(dataDir, call.responsePath!), 'utf8'),
  ) as RecordedResponseFile;
  return {
    content: file.content,
    servedModel: file.servedModel ?? 'recorded',
    finishReason: file.finishReason ?? 'stop',
    usage: file.usage ?? null,
  };
}

function writeRecording(dir: string, role: ModelRole, recording: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${role}.json`), `${JSON.stringify(recording, null, 2)}\n`);
}

/** `--level <level>`, validated; undefined when not given. */
export function levelArg(argv: readonly string[]): ExplanationLevel | undefined {
  const i = argv.indexOf('--level');
  return i < 0 ? undefined : ExplanationLevelSchema.parse(argv[i + 1]);
}

/** `--topic <id>`, validated; the rate limiter when not given. */
export function topicArg(argv: readonly string[]): FixtureTopic {
  const i = argv.indexOf('--topic');
  if (i < 0) return fixtureTopic('rate-limiter');
  const id = argv[i + 1];
  if (!FIXTURE_TOPIC_IDS.includes(id as FixtureTopicId)) {
    throw new Error(
      `--topic must be one of ${FIXTURE_TOPIC_IDS.join(', ')}; got ${id ?? '(none)'}`,
    );
  }
  return fixtureTopic(id as FixtureTopicId);
}

export interface ChainTransport {
  readonly transport: LlmTransport;
  /** Roles that call the configured model in this run (the rest replay recordings). */
  readonly live: readonly FixtureRole[];
}

/**
 * The transport for running the chain up to `role`: each earlier role replays its recorded
 * answers for the topic when it has them, else calls the model live (a topic not recorded yet
 * runs the whole chain live); `role` itself is always live.
 */
export function chainTransport(
  config: AppConfig,
  topic: FixtureTopicId,
  role: FixtureRole,
): ChainTransport {
  const earlier = FIXTURE_ROLES.slice(0, FIXTURE_ROLES.indexOf(role));
  const replayed = earlier.filter((r) => hasRecordedResponses(r, topic));
  const recorded = dryRunTransport(
    Object.fromEntries(
      replayed.map((r) => [r, loadDryRunFixtures(fixtureResponsesDir(r, topic))[r] ?? []]),
    ),
  );
  const live = createLlmTransport(config.llm);
  const replays = new Set<string>(replayed);
  return {
    transport: { send: (req) => (replays.has(req.role) ? recorded : live).send(req) },
    live: [...earlier.filter((r) => !replays.has(r)), role],
  };
}

/** The topic's run in its series, its sources uploaded and its `ingest` job queued. */
export function seedFixtureRun(
  db: Db,
  dataDir: string,
  topic: FixtureTopic,
  level: ExplanationLevel | undefined,
) {
  return seedRunWithUploads(db, dataDir, topic.topic, topic.sourceFiles, {
    seriesTag: topic.seriesTag,
    settings: level ? { video: { explanationLevel: level } } : undefined,
  });
}

/** Each live role's attempts (with the issues each repair listed) and cost. */
export function printLiveRoles(
  db: Db,
  dataDir: string,
  runId: number,
  roles: readonly FixtureRole[],
): void {
  for (const role of roles) {
    const calls = roleCalls(db, runId, role);
    console.log(`  ${role} (live): ${calls.length} call(s), $${callsCostUsd(calls).toFixed(4)}`);
    printAttempts(dataDir, calls);
  }
}

/** The plan, compactly: title, devices, hook, running example, beats and ending. */
export function printPlan(plan: DirectorPlan, notes: ResearchNotes): void {
  const { meta, story } = plan;
  const values = new Map(notes.numbers.map((n) => [n.id, `${n.value} ${n.unit}`.trim()]));
  const hook = story.beats.find((b) => b.device !== 'recap_opening');
  console.log(
    `\n  title: ${meta.title} (${meta.topicClass}, ${meta.format}, ${meta.targetLengthSec ?? '-'} s)`,
  );
  if (plan.lengthReason) console.log(`  length reason: ${plan.lengthReason}`);
  console.log(`  devices: ${story.devices.join(', ')}`);
  if (hook) {
    const numbers = (hook.hookNumberIds ?? [])
      .filter((id) => values.has(id))
      .map((id) => `${id} = ${values.get(id)}`);
    console.log(`  hook (${story.hook.kind}): ${hook.intent} [${numbers.join('; ')}]`);
  }
  console.log(`  running example: ${story.runningExample ?? '(none)'}`);
  if (story.plantedQuestion) {
    const q = story.plantedQuestion;
    console.log(`  planted question: ${q.text} (${q.beatId} -> ${q.payoffBeatId})`);
  }
  if (story.rejectedAlternative) {
    const r = story.rejectedAlternative;
    console.log(`  rejected alternative: ${r.summary} (${r.beatId} -> ${r.chosenBeatId ?? '?'})`);
  }
  for (const part of plan.parts ?? []) {
    console.log(
      `  part ${part.part}: ${part.title} (${part.targetLengthSec} s) ${part.beatIds.join(', ')}`,
    );
  }
  console.log('  beats:');
  for (const b of story.beats) {
    const extras = [
      ...(b.continuesPrevious ? ['continues'] : []),
      b.device ?? '-',
      b.layoutMode ?? '-',
      b.suggestedPatternIds.join('+') || '-',
      b.newTerms.length ? `new: ${b.newTerms.join(', ')}` : '',
      b.source ? `source: ${b.source}` : '',
    ].filter(Boolean);
    console.log(`    ${b.id} [${b.chapterId}] ${b.targetSec} s | ${extras.join(' | ')}`);
    console.log(`      ${b.intent} (${[...(b.hookNumberIds ?? []), ...b.factIds].join(', ')})`);
  }
  const { ending } = story;
  console.log(`  ending: ${ending.kind}`);
  for (const line of ending.specCard?.lines ?? []) console.log(`    | ${line}`);
  if (ending.cta) console.log(`    cta: ${ending.cta}`);
  for (const m of story.missingPrimitiveRequests) {
    console.log(`  missing primitive: ${m.name}: ${m.description} (fallback ${m.fallbackUsed})`);
  }
}

/**
 * Whether to record this run: `--record` given and the role needed at most `--max-repairs <n>`
 * repairs (any number when the flag is absent). Prints why when it does not record.
 */
export function shouldRecord(argv: readonly string[], repairs: number): boolean {
  if (!argv.includes('--record')) return false;
  const i = argv.indexOf('--max-repairs');
  const max = i < 0 ? Number.POSITIVE_INFINITY : Number(argv[i + 1]);
  if (!Number.isInteger(max) && max !== Number.POSITIVE_INFINITY) {
    throw new Error(`--max-repairs needs a whole number; got ${argv[i + 1] ?? '(none)'}`);
  }
  if (repairs <= max) return true;
  console.log(`  not recorded: ${repairs} repair(s), more than --max-repairs ${max}`);
  return false;
}
