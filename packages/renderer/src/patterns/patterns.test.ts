import { describe, expect, it } from 'vitest';
import { elementState, partState, type ElementEvent } from '../primitives/element-state.ts';
import { tickProgress } from '../primitives/counter/format.ts';
import { failoverPattern } from './failover/definition.ts';
import { inferenceCardPattern } from './inference-card/definition.ts';
import { pickByRulePattern } from './pick-by-rule/definition.ts';
import { splitBrainPattern } from './split-brain/definition.ts';
import type { AnyPatternDefinition, PatternExpansion } from './types.ts';
import { workerPoolPattern } from './worker-pool/definition.ts';

/** Each anchor `at.<name>` resolves to one second per anchor, in declaration order. */
function timeline(pattern: AnyPatternDefinition, expansion: PatternExpansion, params: unknown) {
  const at = (params as { at: Record<string, unknown> }).at;
  const secOf = new Map(
    pattern.anchors.map((a, i) => [JSON.stringify(at[a.name]), i + 1] as const),
  );
  return (id: string): ElementEvent[] =>
    expansion.events
      .filter((e) => e.targets.includes(id))
      .map((e) => {
        const sec = secOf.get(JSON.stringify(e.at)) ?? 0;
        return {
          action: e.action,
          frame: sec * 30,
          sec,
          beatEndSec: 10,
          ...(e.params ? { params: e.params } : {}),
        };
      });
}

function expand(pattern: AnyPatternDefinition, params: unknown) {
  const parsed = pattern.paramsSchema.parse(params);
  const expansion = pattern.expand(parsed);
  return { expansion, eventsOf: timeline(pattern, expansion, parsed) };
}

describe('failover', () => {
  const { expansion, eventsOf } = expand(failoverPattern, failoverPattern.example.params);

  it('moves the role badge from the leader to the first follower on promote', () => {
    const role = (id: string, sec: number) =>
      partState(elementState(eventsOf(id), sec * 30, 30), 'role').presence;
    expect(role('leader', 2)).toBe(1);
    expect(role('follower-1', 2)).toBe(0);
    expect(role('leader', 4)).toBe(0);
    expect(role('follower-1', 4)).toBe(1);
  });

  it('re-links the writer and the other followers to the new leader', () => {
    const links = expansion.elements.filter((e) => e.primitive === 'connector');
    expect(links.map((l) => [l.id, l.props.from, l.props.to])).toEqual([
      ['write', 'writer', 'leader'],
      ['repl-1', 'leader', 'follower-1'],
      ['repl-2', 'leader', 'follower-2'],
      ['new-write', 'writer', 'follower-1'],
      ['new-repl-2', 'follower-1', 'follower-2'],
    ]);
  });
});

describe('split_brain', () => {
  const { expansion, eventsOf } = expand(splitBrainPattern, splitBrainPattern.example.params);

  it('ends with both nodes holding the role badge', () => {
    const role = (id: string, sec: number) =>
      partState(elementState(eventsOf(id), sec * 30, 30), 'role').presence;
    expect(role('replica', 1)).toBe(0);
    expect(role('replica', 6)).toBe(1);
    expect(role('leader', 6)).toBe(1);
  });

  it('counts the outage on narration time from the partition to the heal', () => {
    const outage = expansion.elements.find((e) => e.id === 'outage');
    expect(outage?.props).toMatchObject({ ticking: true, from: 0, value: 43 });
    const at = (sec: number) => {
      const state = elementState(eventsOf('outage'), sec * 30, 30);
      return tickProgress(state.elapsed.count, state.runSec.count);
    };
    expect(at(3.5)).toBeCloseTo(0.5);
    expect(at(5)).toBe(1);
  });

  it('leaves the lease timer out when there is no lease', () => {
    const params: Record<string, unknown> = { ...splitBrainPattern.example.params };
    delete params.lease;
    const ids = splitBrainPattern
      .expand(splitBrainPattern.paramsSchema.parse(params))
      .elements.map((e) => e.id);
    expect(ids).not.toContain('lease');
    expect(ids).toContain('outage');
  });
});

describe('inference_card', () => {
  const base = inferenceCardPattern.example.params as Record<string, unknown> & {
    at: Record<string, unknown>;
  };

  it('needs at.compare exactly when there is a comparison', () => {
    const at = { ...base.at };
    delete at.compare;
    expect(inferenceCardPattern.paramsSchema.safeParse({ ...base, at }).success).toBe(false);
    const single: Record<string, unknown> = { ...base };
    delete single.comparison;
    expect(inferenceCardPattern.paramsSchema.safeParse({ ...single, at }).success).toBe(true);
    expect(inferenceCardPattern.paramsSchema.safeParse({ ...single }).success).toBe(false);
  });

  it('starts the prediction unknown', () => {
    const { expansion } = expand(inferenceCardPattern, base);
    expect(expansion.elements.find((e) => e.id === 'prediction')?.props).toMatchObject({
      from: null,
      to: 14,
    });
  });
});

describe('pick_by_rule', () => {
  const base = pickByRulePattern.example.params as Record<string, unknown>;

  it('rejects picks that are not candidates or that pick the obvious one', () => {
    const unknown = { ...base, pick: { candidate: 'example-z', reason: 'X' } };
    const same = { ...base, pick: { candidate: 'example-a', reason: 'X' } };
    const issues = (params: unknown) =>
      pickByRulePattern.paramsSchema.safeParse(params).error?.issues.map((i) => i.path.join('.'));
    expect(issues(unknown)).toEqual(['pick.candidate']);
    expect(issues(same)).toEqual(['pick.candidate']);
  });

  it('crosses out the obvious candidate and links the right one to the target', () => {
    const { expansion } = expand(pickByRulePattern, base);
    const rejected = expansion.events
      .filter((e) => e.action === 'reject')
      .flatMap((e) => e.targets);
    expect(rejected).toEqual(['candidate-example-a', 'obvious-tag']);
    expect(expansion.elements.find((e) => e.id === 'pick-link')?.props).toMatchObject({
      from: 'candidate-example-b',
      to: 'target',
    });
  });
});

describe('worker_pool', () => {
  it('needs at least as many jobs as workers', () => {
    const params = {
      ...(workerPoolPattern.example.params as object),
      jobs: ['A', 'B'],
      workers: [{ title: 'W1' }, { title: 'W2' }, { title: 'W3' }],
    };
    expect(workerPoolPattern.paramsSchema.safeParse(params).success).toBe(false);
  });
});
