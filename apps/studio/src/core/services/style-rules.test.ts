import { MAX_RULES_PER_AGENT, type MemoryRuleScope } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendEvent } from '../db/repositories/events.ts';
import { createRun, deleteRun } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import {
  activeStyleRules,
  addRule,
  deleteRule,
  getRule,
  listRules,
  proposalOfEvent,
  recordProposal,
  updateRule,
} from './style-rules.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const add = (scope: MemoryRuleScope, text = `<rule-${scope}>`) => addRule(t.db, { scope, text });

/** A proposal from a gate decision event on a new run. */
function proposal(text = '<proposed-rule>', scope: MemoryRuleScope = 'scriptwriter') {
  const run = createRun(t.db, {
    app: TEST_APP_SETTINGS,
    topicId: createTopic(t.db, { title: '<topic>' }).id,
    seriesId: listSeries(t.db)[0]!.id,
  });
  const event = appendEvent(t.db, {
    runId: run.id,
    type: 'gate',
    payload: {
      gate: 'scenes',
      status: 'rejected',
      decidedBy: 'user',
      blocking: [],
      decision: { action: 'reject', note: '<example-note>' },
    },
  });
  const rule = recordProposal(t.db, {
    scope,
    text,
    note: '<example-note>',
    reason: '<example-reason>',
    sourceRunId: run.id,
    sourceGate: 'scenes',
    sourceEventId: event.id,
  });
  return { run, event, rule };
}

describe('activeStyleRules', () => {
  it('gives each agent its own rules and "all" (writers only), oldest first, active only', () => {
    for (const scope of ['all', 'director', 'scriptwriter', 'generator', 'curator'] as const) {
      add(scope);
    }
    const off = add('director', '<rule-off>');
    updateRule(t.db, off.id, { action: 'deactivate' });
    proposal('<rule-proposed>', 'director');
    expect(activeStyleRules(t.db, 'director')).toEqual(['<rule-all>', '<rule-director>']);
    expect(activeStyleRules(t.db, 'scriptwriter')).toEqual(['<rule-all>', '<rule-scriptwriter>']);
    expect(activeStyleRules(t.db, 'generator')).toEqual(['<rule-all>', '<rule-generator>']);
    expect(activeStyleRules(t.db, 'curator')).toEqual(['<rule-curator>']);
  });
});

describe('rule changes', () => {
  it('accepts a proposal, with an edited text and scope', () => {
    const { rule, event } = proposal();
    expect(proposalOfEvent(t.db, event.id)?.id).toBe(rule.id);
    const accepted = updateRule(t.db, rule.id, {
      action: 'accept',
      text: '<edited>',
      scope: 'all',
    });
    expect(accepted).toMatchObject({ status: 'active', text: '<edited>', scope: 'all' });
    expect(accepted.note).toBe('<example-note>');
  });

  it('moves only from the status an action starts from', () => {
    const { rule } = proposal();
    expect(() => updateRule(t.db, rule.id, { action: 'activate' })).toThrow(
      /is proposed: only a inactive rule can be activated/,
    );
    updateRule(t.db, rule.id, { action: 'reject' });
    expect(() => updateRule(t.db, rule.id, { action: 'accept' })).toThrow(ConflictError);
    expect(() => updateRule(t.db, rule.id, { text: '<again>' })).toThrow(/was rejected/);
    const active = add('generator');
    expect(updateRule(t.db, active.id, { action: 'deactivate' }).status).toBe('inactive');
    expect(updateRule(t.db, active.id, { action: 'activate' }).status).toBe('active');
  });

  it(`refuses a ${MAX_RULES_PER_AGENT + 1}th active rule for any agent it would reach`, () => {
    for (let i = 0; i < MAX_RULES_PER_AGENT - 1; i += 1) add('generator', `<g-${i}>`);
    add('all', '<all-1>'); // the generator now has 12: its 11 and one "all"
    expect(() => add('generator')).toThrow(/The generator already has 12 active rules/);
    expect(() => add('all')).toThrow(/The generator already has 12/);
    add('director'); // others have room
    const { rule } = proposal('<proposed>', 'generator');
    expect(() => updateRule(t.db, rule.id, { action: 'accept' })).toThrow(ConflictError);
    // Accepted into another scope, it fits; editing an active rule keeps its own place.
    expect(updateRule(t.db, rule.id, { action: 'accept', scope: 'curator' }).status).toBe('active');
    const own = listRules(t.db, { scope: 'generator' })[0]!;
    expect(updateRule(t.db, own.id, { text: '<g-edited>' }).text).toBe('<g-edited>');
  });

  it('deletes a rule; an unknown one is not found', () => {
    const rule = add('director');
    deleteRule(t.db, rule.id);
    expect(getRule(t.db, rule.id)).toBeUndefined();
    expect(() => deleteRule(t.db, rule.id)).toThrow(NotFoundError);
    expect(() => updateRule(t.db, 999, { action: 'accept' })).toThrow(NotFoundError);
  });

  it('keeps a proposal when the run it came from is deleted', () => {
    const { run, rule } = proposal();
    expect(deleteRun(t.db, run.id)).toBe(true);
    expect(getRule(t.db, rule.id)).toMatchObject({ sourceRunId: null, sourceEventId: null });
  });
});
