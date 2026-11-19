import { EVENT_ACTIONS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { inputJsonSchema } from '../catalog/catalogue.ts';
import { LAYOUT_MODE_IDS, LAYOUT_MODES } from '../layout/modes.ts';
import { PRIMITIVES } from '../primitives/registry.ts';
import { expansionProblems, undocumentedTargets } from './expansion-checks.ts';
import { buildPatternRegistry, getPattern, listPatterns } from './registry.ts';
import { bouncePattern } from './test-pattern.ts';
import { PATTERN_INSTANCE_ACTIONS, type AnyPatternDefinition } from './types.ts';

const patternIds = new Set(listPatterns().map((p) => p.id));
const primitiveIds = new Set(PRIMITIVES.keys());

type JsonObject = { properties?: Record<string, JsonObject>; required?: string[] };

function anchorSchema(pattern: AnyPatternDefinition): JsonObject | undefined {
  const params = inputJsonSchema(pattern.paramsSchema) as JsonObject;
  return params.properties?.at;
}

describe.each(listPatterns().map((p) => [p.id, p] as const))('pattern %s', (_id, pattern) => {
  it('offers only instance actions and keeps enter, reject and lock for itself', () => {
    for (const action of pattern.actions) {
      expect(EVENT_ACTIONS).toContain(action);
      expect(PATTERN_INSTANCE_ACTIONS).toContain(action);
    }
  });

  it('takes one anchor in params.at per declared anchor, optional ones optional', () => {
    const at = anchorSchema(pattern);
    expect(Object.keys(at?.properties ?? {})).toEqual(pattern.anchors.map((a) => a.name));
    const required = pattern.anchors.filter((a) => !a.optional).map((a) => a.name);
    expect(at?.required ?? []).toEqual(required);
  });

  it('declares a known layout mode', () => {
    expect(LAYOUT_MODE_IDS).toContain(pattern.layoutMode);
  });

  it('describes itself for the LLM, naming only known ids in backticks', () => {
    const params = Object.keys((inputJsonSchema(pattern.paramsSchema) as JsonObject).properties!);
    const allowed = new Set([
      ...primitiveIds,
      ...patternIds,
      ...pattern.actions,
      ...pattern.anchors.map((a) => a.name),
      ...params,
    ]);
    const text = Object.values(pattern.description).join(' ');
    for (const text_ of Object.values(pattern.description))
      expect(text_.length).toBeGreaterThan(20);
    for (const [, name] of text.matchAll(/`([^`]+)`/g)) expect(allowed, name).toContain(name);
  });

  it('documents every inner element of its example', () => {
    const expansion = pattern.expand(pattern.paramsSchema.parse(pattern.example.params));
    expect(undocumentedTargets(expansion, pattern.targets)).toEqual([]);
    expect(new Set(pattern.targets.map((t) => t.id)).size).toBe(pattern.targets.length);
  });

  it('rejects unknown params', () => {
    const params = { ...(pattern.example.params as object), notAParam: 1 };
    expect(pattern.paramsSchema.safeParse(params).success).toBe(false);
  });
});

describe('pattern registry', () => {
  it('registers the P1A.8 patterns', () => {
    expect([...patternIds]).toEqual([
      'atomic_lock',
      'reject_duplicate',
      'fan_out',
      'flood_then_funnel',
      'converge_adapter',
      'cache_hit_miss',
      'worker_pool',
      'brute_force_then_index',
      'versus_split',
      'inference_card',
      'pick_by_rule',
      'failover',
      'split_brain',
    ]);
    expect(getPattern('fan_out')?.layoutMode).toBe('pipeline');
    expect(getPattern('node_box')).toBeUndefined();
  });

  it('registers a pattern whose example expands into valid primitives and events', () => {
    const registry = buildPatternRegistry([bouncePattern]);
    expect(registry.get('test_bounce')).toBe(bouncePattern);
    const params = bouncePattern.paramsSchema.parse(bouncePattern.example.params);
    const expansion = bouncePattern.expand(params);
    expect(expansion.elements.map((e) => e.primitive)).toEqual(['tag', 'tag']);
    expect(expansion.events.map((e) => e.action)).toEqual(['enter', 'reject']);
  });

  it('rejects duplicates, bad example params and expansions that use unknown primitives', () => {
    expect(() => buildPatternRegistry([bouncePattern, bouncePattern])).toThrow(/Duplicate/);
    const badParams = { ...bouncePattern, example: { params: { label: '' } } };
    expect(() => buildPatternRegistry([badParams])).toThrow(/Example params/);
    const badExpansion = {
      ...bouncePattern,
      expand: () => ({ elements: [{ id: 'x', primitive: 'node_box', props: {} }], events: [] }),
    };
    expect(() => buildPatternRegistry([badExpansion])).toThrow(/unknown primitive "node_box"/);
  });

  it('rejects instance actions the pattern must keep for itself', () => {
    const entering = { ...bouncePattern, actions: ['enter', 'dim'] as const };
    expect(() => buildPatternRegistry([entering])).toThrow(/must keep: enter/);
  });

  it('rejects events that are not anchored to params.at', () => {
    const drifting = {
      ...bouncePattern,
      expand: (params: { label: string }) => {
        const expansion = bouncePattern.expand(bouncePattern.paramsSchema.parse(params));
        const offset = { type: 'beat', edge: 'start', offsetSec: 1 } as const;
        return { ...expansion, events: [{ ...expansion.events[0]!, at: offset }] };
      },
    } as unknown as AnyPatternDefinition;
    expect(() => buildPatternRegistry([drifting])).toThrow(/not anchored to params.at/);
  });

  it('rejects inner elements the definition does not document', () => {
    const quiet = { ...bouncePattern, targets: [{ id: 'held', description: 'The held label.' }] };
    expect(() => buildPatternRegistry([quiet])).toThrow(/"second" is not in targets/);
  });
});

describe('expansionProblems', () => {
  const at = { type: 'word', index: 0 } as const;

  it('reports duplicate ids, bad props and unknown targets', () => {
    const problems = expansionProblems(
      {
        elements: [
          { id: 'a', primitive: 'tag', props: { text: 'ok' }, zone: 'left' },
          { id: 'a', primitive: 'tag', props: { text: '' }, zone: 'left' },
        ],
        events: [{ at, action: 'enter', targets: ['b'] }],
      },
      'two_column',
      PRIMITIVES,
    );
    expect(problems).toEqual([
      'duplicate element id "a"',
      expect.stringMatching(/^invalid props on "a"/),
      'event targets unknown "b"',
    ]);
  });

  it('needs a zone of the layout mode on every element that points to nothing', () => {
    const problems = expansionProblems(
      {
        elements: [
          { id: 'a', primitive: 'tag', props: { text: 'a' } },
          { id: 'b', primitive: 'tag', props: { text: 'b' }, zone: 'hub' },
          { id: 'c', primitive: 'tag', props: { text: 'c' }, zone: 'left' },
          { id: 'ab', primitive: 'connector', props: { from: 'a', to: 'c' } },
        ],
        events: [],
      },
      'two_column',
      PRIMITIVES,
    );
    expect(problems).toEqual([
      '"a" has no zone (two_column: left, right, aside)',
      '"b" is in zone "hub", which two_column lacks (left, right, aside)',
    ]);
  });

  it('keeps element refs inside the expansion and checks their kind and parts', () => {
    const problems = expansionProblems(
      {
        elements: [
          { id: 'a', primitive: 'tag', props: { text: 'a' }, zone: 'left' },
          { id: 'out', primitive: 'connector', props: { from: 'a', to: 'elsewhere' } },
          { id: 'flow', primitive: 'packet_stream', props: { along: 'a' } },
          {
            id: 'brace',
            primitive: 'bracket',
            props: { targets: ['a'], parts: ['p'], label: 'X' },
          },
        ],
        events: [],
      },
      'two_column',
      PRIMITIVES,
    );
    expect(problems).toEqual([
      '"out" points to "elsewhere", which is not in the expansion',
      '"flow" points to "a" (tag)',
      '"brace" names part "p", which "a" lacks',
    ]);
  });

  it('checks event actions and parts against the targets', () => {
    const queue = {
      id: 'q',
      primitive: 'conveyor_queue',
      props: { items: [{ id: 'j1', label: 'J1' }] },
      zone: 'left',
    };
    const problems = expansionProblems(
      {
        elements: [{ id: 'a', primitive: 'tag', props: { text: 'a' }, zone: 'left' }, queue],
        events: [
          { at, action: 'count', targets: ['a'] },
          { at, action: 'exit', targets: ['q'], params: { parts: ['j9'] } },
          { at, action: 'move', targets: ['q'], params: { parts: ['j1'] } },
          { at, action: 'exit', targets: ['q', 'a'], params: { parts: ['j1'] } },
        ],
      },
      'two_column',
      PRIMITIVES,
    );
    expect(problems).toEqual([
      '"a" (tag) does not support "count"',
      '"q" has no part "j9"',
      'parts of "q" do not support "move"',
      'an event that names parts needs one target',
    ]);
  });
});

describe('layout modes', () => {
  it('lists every P1A.9 mode with at least one zone', () => {
    expect(LAYOUT_MODES.size).toBe(LAYOUT_MODE_IDS.length);
    for (const mode of LAYOUT_MODES.values()) expect(mode.zones.length).toBeGreaterThan(0);
  });
});
