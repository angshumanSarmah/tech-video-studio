import { describe, expect, it } from 'vitest';
import { PRIMITIVES } from '../primitives/registry.ts';
import { buildPatternRegistry, expansionProblems, listPatterns } from './registry.ts';
import { bouncePattern } from './test-pattern.ts';

describe('pattern registry', () => {
  it('is empty until P1A.8', () => {
    expect(listPatterns()).toEqual([]);
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

  it('reports every problem in an expansion', () => {
    const problems = expansionProblems(
      {
        elements: [
          { id: 'a', primitive: 'tag', props: { text: 'ok' } },
          { id: 'a', primitive: 'tag', props: { text: '' } },
        ],
        events: [{ at: { type: 'word', index: 0 }, action: 'enter', targets: ['b'] }],
      },
      PRIMITIVES,
    );
    expect(problems).toEqual([
      'duplicate element id "a"',
      expect.stringMatching(/^invalid props on "a"/),
      'event targets unknown "b"',
    ]);
  });
});
