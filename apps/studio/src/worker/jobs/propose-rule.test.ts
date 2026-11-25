import { join } from 'node:path';
import { SettingsSchema } from '@explainer-studio/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { llmCalls } from '#core/db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '#core/db/testing.ts';
import { requestRuleProposal } from '#core/services/rule-proposals.ts';
import { addRule, listRules, proposalOfEvent } from '#core/services/style-rules.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import {
  ANALYST_RESPONSES_DIR,
  FIXTURE_NOTES,
  seedNote,
  seedProposalRun,
  type SeededRun,
} from '../agents/analyst/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import { createLlmClient } from '../llm/client.ts';
import { dryRunTransport, loadDryRunFixtures, type DryRunResponse } from '../llm/dry-run.ts';
import { runNextJob } from '../runner.ts';
import { proposeRuleJobHandler } from './propose-rule.ts';
import { createJobRegistry } from './registry.ts';

const root = findWorkspaceRoot(import.meta.dirname);
const prompts = loadPromptTemplates(join(root, PROMPTS_DIR));
const recorded = loadDryRunFixtures(join(root, ANALYST_RESPONSES_DIR)).analyst as DryRunResponse[];

let t: TestDb;
let seeded: SeededRun;

beforeEach(() => {
  t = createTestDb();
  seeded = seedProposalRun(t.db, t.dataDir, TEST_APP_SETTINGS);
});

afterEach(() => t.cleanup());

const answer = (value: unknown): DryRunResponse => ({ content: JSON.stringify(value) });

/** Runs one proposal for the fixture note `noteId` with these answers queued. */
async function propose(noteId: string, answers: readonly DryRunResponse[]) {
  const note = FIXTURE_NOTES.find((n) => n.id === noteId)!;
  const eventId = seedNote(t.db, t.dataDir, seeded, note);
  return run(eventId, answers);
}

async function run(eventId: number, answers: readonly DryRunResponse[]) {
  const job = t.db.transaction((tx) => requestRuleProposal(tx, eventId));
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: SettingsSchema.parse({}).llm,
    transport: dryRunTransport({ analyst: [...answers] }),
  });
  const registry = createJobRegistry([
    proposeRuleJobHandler({ db: t.db, dataDir: t.dataDir, llm, prompts }),
  ]);
  await runNextJob({ db: t.db, registry, workerId: 't', signal: new AbortController().signal });
  const logs = listEventsSince(t.db, { jobId: job.id, afterId: 0, limit: 100 }).flatMap((e) =>
    e.type === 'log' ? [e.payload.message] : [],
  );
  return { job: getJob(t.db, job.id)!, eventId, logs, rule: proposalOfEvent(t.db, eventId) };
}

const analystCalls = () =>
  t.db
    .select()
    .from(llmCalls)
    .where(and(isNull(llmCalls.runId), eq(llmCalls.role, 'analyst')))
    .orderBy(asc(llmCalls.id))
    .all();

describe('propose_rule job (recorded analyst answers)', () => {
  it('replays the live run of the five fixture notes, each in one call outside any run', async () => {
    expect(recorded).toHaveLength(FIXTURE_NOTES.length);
    const outcomes = [];
    for (const [i, note] of FIXTURE_NOTES.entries()) {
      const { job, rule, logs } = await propose(note.id, [recorded[i]!]);
      expect(job.status, job.error ?? '').toBe('done');
      expect(job.runId).toBeNull();
      outcomes.push(rule ? `${note.id}: ${rule.scope}` : `${note.id}: ${logs.join(' ')}`);
    }
    // As recorded (analyst@v2): four rules, and the one-off date stays one-off.
    expect(outcomes).toEqual([
      'headline-edit: scriptwriter',
      'busy-board: generator',
      'same-opening: director',
      expect.stringMatching(/^wrong-date: No rule \(one_off\): /),
      'contractions: curator',
    ]);
    const rules = listRules(t.db);
    expect(rules.every((r) => r.status === 'proposed' && r.sourceRunId === seeded.run.id)).toBe(
      true,
    );
    expect(rules[0]).toMatchObject({ sourceGate: 'scenes', note: FIXTURE_NOTES[0]!.note });
    expect(rules[0]!.reason).toBeTruthy();
    const calls = analystCalls();
    expect(calls).toHaveLength(FIXTURE_NOTES.length);
    expect(calls.every((c) => c.costUsd > 0 && c.promptPath.startsWith('llm/'))).toBe(true);
  });

  it('sends the scopes, the output shape, the edit’s changes and the rules there are', async () => {
    await propose('headline-edit', [recorded[0]!]);
    await propose('busy-board', [recorded[1]!]);
    const [, second] = analystCalls();
    const prompt = readDataJson(t.dataDir, second!.promptPath) as {
      messages: { role: string; content: string }[];
    };
    const [system, user] = prompt.messages;
    expect(system!.content).toContain('Role: Analyst.');
    expect(system!.content).toContain('## OUTPUT SHAPE');
    expect(system!.content).toContain('## RULE SCOPES (exhaustive');
    expect(user!.content).toContain('decision: regenerate');
    expect(user!.content).toContain('THE BEAT IT CONCERNS (beat7');
    expect(user!.content).toContain('- inst_a · node_card');
    const first = listRules(t.db)[0]!;
    expect(user!.content).toContain(`- rule ${first.id} [scriptwriter, proposed]: ${first.text}`);

    const editPrompt = readDataJson(t.dataDir, analystCalls()[0]!.promptPath) as {
      messages: { content: string }[];
    };
    expect(editPrompt.messages[1]!.content).toContain(
      '- $.script[4].headline.text: "Every check crosses the network" → "Checks cross the network"',
    );
  });
});

describe('propose_rule job (hand-written answers)', () => {
  const ruleAnswer = (text: string, scope = 'scriptwriter') =>
    answer({ rule: { text, scope, why: '<example-why>' } });

  it('repairs a rule that names the video', async () => {
    const { rule } = await propose('headline-edit', [
      ruleAnswer('Keep rate limiters headlines short.'),
      ruleAnswer('Keep every headline to a few words.'),
    ]);
    expect(rule?.text).toBe('Keep every headline to a few words.');
    const [first, second] = analystCalls();
    expect(first?.error).toMatch(/rule_names_video/);
    expect(second?.error).toBeNull();
  });

  it('settles a word-for-word repeat of a rule as a duplicate, and logs a note with no rule', async () => {
    const existing = addRule(t.db, { scope: 'scriptwriter', text: 'Keep every headline short.' });
    const duplicate = await propose('headline-edit', [ruleAnswer('keep every headline short')]);
    expect(duplicate.rule).toBeUndefined();
    expect(duplicate.logs).toContain(
      `No rule (duplicate (rule ${existing.id})): Rule ${existing.id} already says it: "Keep every headline short.".`,
    );
    const oneOff = await propose('wrong-date', [
      answer({ rule: null, noRule: { reason: 'one_off', detail: 'Only this video’s date.' } }),
    ]);
    expect(oneOff.logs).toContain('No rule (one_off): Only this video’s date.');
  });

  it('proposes once per event: a second request is refused, a rerun of the job calls nothing', async () => {
    const { eventId, job } = await propose('same-opening', [
      ruleAnswer('<example-rule>', 'director'),
    ]);
    expect(() => t.db.transaction((tx) => requestRuleProposal(tx, eventId))).toThrow(
      /already proposed/,
    );
    // At-least-once delivery: the same job's payload again finds the rule and stops.
    const registry = createJobRegistry([
      proposeRuleJobHandler({
        db: t.db,
        dataDir: t.dataDir,
        llm: createLlmClient({
          db: t.db,
          dataDir: t.dataDir,
          llm: SettingsSchema.parse({}).llm,
          transport: dryRunTransport({ analyst: [] }),
        }),
        prompts,
      }),
    ]);
    const handler = registry.get('propose_rule')!;
    const logs: string[] = [];
    await handler.run({
      job,
      payload: { eventId },
      progress: () => {},
      log: (_level, message) => logs.push(message),
      signal: new AbortController().signal,
    });
    expect(logs).toEqual([
      `Rule ${proposalOfEvent(t.db, eventId)!.id} was already proposed from event ${eventId}.`,
    ]);
    expect(analystCalls()).toHaveLength(1);
  });
});
