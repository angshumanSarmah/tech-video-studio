import {
  CurateInputSchema,
  MemoryRuleDtoSchema,
  MemoryRuleListResponseSchema,
  ProposeRuleResponseSchema,
  RepairInputSchema,
  ScriptwriterInputSchema,
  type EventDto,
  type MemoryRuleScope,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { latestDoneStep } from '#core/db/repositories/run-steps.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { memoryRules } from '#core/db/schema.ts';
import { latestDirection } from '#core/services/direction.ts';
import { STYLE_RULES_HEADING } from '#worker/agents/sections.ts';
import { curateRound } from '#worker/agents/curator/testing.ts';
import { decided, expectError, Harness } from './harness.ts';

/**
 * P1C.10's acceptance (M2, style rules), through the API and the dry-run worker: every gate
 * decision is one `gate` event that carries it; a note becomes a proposal only when asked
 * (`proposeRule`, or `POST /api/memory/rules/propose`), by a job outside the run; accepted, the
 * rule reaches the next run's prompts, each agent only the rules of its scope.
 */

let h: Harness;

beforeEach(() => {
  h = new Harness('tokenizer');
});

afterEach(() => h.cleanup());

const t = () => h.t;

const RULE = 'Keep every headline to a few words.';
const ruleAnswer = (text: string, scope: MemoryRuleScope) => ({
  content: JSON.stringify({ rule: { text, scope, why: '<example-why>' } }),
});

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/api/memory${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }),
  );
}

async function rules(query = '') {
  return MemoryRuleListResponseSchema.parse(await (await api('GET', `/rules${query}`)).json())
    .items;
}

const gateEvent = (runId: number, eventId: number) =>
  h.events(runId).find((e): e is Extract<EventDto, { type: 'gate' }> => e.id === eventId);

/** The run's prompt (system, user) of each call of a role. */
function prompts(runId: number, role: string) {
  return listRunLlmCalls(t().db, runId)
    .filter((c) => c.role === role)
    .map((c) => {
      const file = readDataJson(t().dataDir, c.promptPath) as { messages: { content: string }[] };
      return { system: file.messages[0]!.content, user: file.messages[1]!.content };
    });
}

describe('gate decisions and proposals', () => {
  it('records each decision as one gate event and proposes a rule only when asked', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const before = latestDirection(t().db, t().dataDir, runId)!;
    const plan = structuredClone(before.plan);
    plan.story.beats[0]!.intent = `${plan.story.beats[0]!.intent} (shorter)`;

    const edit = await decided(
      await h.post(runId, 'beat_sheet', {
        action: 'edit',
        subjectId: before.step.id,
        content: plan,
        notes: 'The hook intent should say what the viewer sees.',
        proposeRule: true,
      }),
    );
    expect(gateEvent(runId, edit.eventId)?.payload).toEqual({
      gate: 'beat_sheet',
      status: 'pending',
      decidedBy: 'user',
      blocking: [],
      decision: {
        action: 'edit',
        note: 'The hook intent should say what the viewer sees.',
        subjectId: before.step.id,
        savedId: edit.saved!.id,
      },
    });
    // The Analyst's job belongs to no run: the run's own jobs and cost never see it.
    const job = getJob(t().db, edit.proposalJobId!)!;
    expect(job).toMatchObject({ type: 'propose_rule', runId: null, status: 'queued' });

    await h.drain({ analyst: [ruleAnswer('<example-director-rule>', 'director')] });
    expect(getJob(t().db, job.id)!.status).toBe('done');
    const [proposed] = await rules('?status=proposed');
    expect(proposed).toMatchObject({
      scope: 'director',
      text: '<example-director-rule>',
      note: 'The hook intent should say what the viewer sees.',
      reason: '<example-why>',
      sourceRunId: runId,
      sourceGate: 'beat_sheet',
      sourceEventId: edit.eventId,
    });
    expect(listRunLlmCalls(t().db, runId).some((c) => c.role === 'analyst')).toBe(false);

    // No note, no proposal; a decision without proposeRule queues nothing.
    const bare = await h.post(runId, 'beat_sheet', {
      action: 'approve',
      subjectId: edit.saved!.id,
      proposeRule: true,
    });
    expect((await expectError(bare, 400)).message).toMatch(/proposed from a note/);
    const rejected = await decided(
      await h.post(runId, 'beat_sheet', { action: 'reject', notes: 'Too long for a Short.' }),
    );
    expect(rejected.proposalJobId).toBeNull();
    expect(gateEvent(runId, rejected.eventId)?.payload.decision).toEqual({
      action: 'reject',
      note: 'Too long for a Short.',
    });

    // Later, from the event: queued once; a second request, a missing note or event refused.
    const res = await api('POST', '/rules/propose', { eventId: rejected.eventId });
    expect(res.status).toBe(202);
    const { jobId } = ProposeRuleResponseSchema.parse(await res.json());
    expect(getJob(t().db, jobId)?.runId).toBeNull();
    await expectError(await api('POST', '/rules/propose', { eventId: rejected.eventId }), 409);
    const statusEvent = h.events(runId).find((e) => e.type === 'run_status')!;
    await expectError(await api('POST', '/rules/propose', { eventId: statusEvent.id }), 400);
    await expectError(await api('POST', '/rules/propose', { eventId: 99_999 }), 404);
  });
});

describe('a note becomes a rule for the next run', () => {
  it('note -> proposal -> accept -> the next run’s Scriptwriter prompt carries it, its Director’s does not', async () => {
    const first = await h.runUntilWaiting({ research: true });
    const note = await decided(
      await h.post(first, 'beat_sheet', {
        action: 'reject',
        notes: 'Headlines read like whole sentences; keep them short.',
        proposeRule: true,
      }),
    );
    expect(getRun(t().db, first)!.status).toBe('cancelled');
    await h.drain({ analyst: [ruleAnswer(RULE, 'scriptwriter')] });
    const [proposed] = await rules();
    expect(proposed).toMatchObject({ status: 'proposed', sourceEventId: note.eventId });
    const accepted = await api('PATCH', `/rules/${proposed!.id}`, { action: 'accept' });
    expect(MemoryRuleDtoSchema.parse(await accepted.json())).toMatchObject({ status: 'active' });

    const second = h.start({ autoApprove: { research: true, beat_sheet: true } });
    h.drop('researcher');
    h.drop('director'); // the first run used the recorded plan: the second replays it again
    await h.drain(
      { researcher: h.researcherFor(second), director: h.recording('director') },
      4, // ingest, research, direct, script
    );
    expect(getRun(t().db, second)!.pipelineStep, h.logs(second).join('\n')).toBe('tts');

    const [script] = prompts(second, 'scriptwriter');
    expect(script!.system.endsWith(`${STYLE_RULES_HEADING}\n- ${RULE}`)).toBe(true);
    for (const director of prompts(second, 'director')) {
      expect(director.system).not.toContain(RULE);
    }
    const step = latestDoneStep(t().db, second, 'script')!;
    const input = ScriptwriterInputSchema.parse(readDataJson(t().dataDir, step.inputPath!));
    expect(input.styleRules).toEqual([RULE]);

    // Where the rule sits and how it reads: the end of the system message, after the output
    // schema (the cached prefix), then the run's input.
    const lines = script!.system.split('\n');
    const at = lines.indexOf(STYLE_RULES_HEADING);
    const snapshot = [
      '===== system (its last lines: the output schema ends, then the style rules) =====',
      ...lines.slice(at - 4),
      '===== user (its first lines) =====',
      ...script!.user.split('\n').slice(0, 12),
      '',
    ].join('\n');
    await expect(snapshot).toMatchFileSnapshot(
      '../worker/agents/__snapshots__/scriptwriter.with-rule.prompt.txt',
    );
  });
});

describe('rule scoping', () => {
  it('each agent gets its own scope’s rules (and "all" for the writers); nothing else', async () => {
    const add = async (scope: MemoryRuleScope) => {
      const res = await api('POST', '/rules', { scope, text: `<rule-${scope}>` });
      expect(res.status).toBe(201);
      return MemoryRuleDtoSchema.parse(await res.json());
    };
    for (const scope of ['all', 'director', 'scriptwriter', 'generator', 'curator'] as const) {
      await add(scope);
    }
    const off = await add('director');
    await api('PATCH', `/rules/${off.id}`, { action: 'deactivate', text: '<rule-inactive>' });
    t()
      .db.insert(memoryRules)
      .values({ scope: 'all', text: '<rule-proposed>', status: 'proposed' })
      .run();

    const runId = h.start({
      autoApprove: { research: true, beat_sheet: true, scenes: true, draft: true },
    });
    await h.drain(curateRound('tokenizer'));
    expect(getRun(t().db, runId)!.status).toBe('done');

    const texts = [
      'all',
      'director',
      'scriptwriter',
      'generator',
      'curator',
      'inactive',
      'proposed',
    ];
    const seen = (role: string) => {
      const found = prompts(runId, role).map((p) =>
        texts.filter((x) => p.system.includes(`<rule-${x}>`)),
      );
      expect(found.length, role).toBeGreaterThan(0);
      expect(new Set(found.map((f) => f.join(','))).size, `${role}: one set per call`).toBe(1);
      return found[0];
    };
    expect(seen('researcher')).toEqual([]);
    expect(seen('director')).toEqual(['all', 'director']);
    expect(seen('scriptwriter')).toEqual(['all', 'scriptwriter']);
    expect(seen('generator')).toEqual(['all', 'generator']);
    expect(seen('curator')).toEqual(['curator']);

    const curate = latestDoneStep(t().db, runId, 'curate')!;
    expect(
      CurateInputSchema.parse(readDataJson(t().dataDir, curate.inputPath!)).styleRules,
    ).toEqual(['<rule-curator>']);
    const repair = latestDoneStep(t().db, runId, 'repair');
    expect(repair, 'the recorded Curator round repairs a beat').toBeDefined();
    expect(
      RepairInputSchema.parse(readDataJson(t().dataDir, repair!.inputPath!)).styleRules,
    ).toEqual({
      scriptwriter: ['<rule-all>', '<rule-scriptwriter>'],
      generator: ['<rule-all>', '<rule-generator>'],
    });
  });
});
