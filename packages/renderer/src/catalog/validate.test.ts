import { validateRenderableVideoSpec, validateVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { listPrimitives } from '../primitives/registry.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { fixtureSpec, registryValidSpec } from './test-specs.ts';
import { findRegistryErrors, withRegistryChecks } from './validate.ts';

const check = (input: unknown, registries: Registries = DEFAULT_REGISTRIES) =>
  withRegistryChecks(validateVideoSpec(input), input, registries);

const withPatterns: Registries = {
  ...DEFAULT_REGISTRIES,
  patterns: buildPatternRegistry([bouncePattern]),
};

describe('withRegistryChecks', () => {
  it('accepts a spec that only uses registered primitives with valid props and actions', () => {
    const input = registryValidSpec();
    expect(validateVideoSpec(input).ok).toBe(true);
    expect(check(input)).toMatchObject({ ok: true, errors: [] });
    expect(withRegistryChecks(validateRenderableVideoSpec(input), input).ok).toBe(true);
  });

  it('rejects unknown primitive and pattern ids, listing the valid ones', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, { primitive: 'node_box' });
    const result = check(input);
    expect(result.ok).toBe(false);
    expect(result.spec).toBeUndefined();
    expect(result.errors).toContainEqual({
      path: '$.scenes[0].elements[0].primitive',
      code: 'unknown_reference',
      message: `Unknown primitive "node_box". Use one of: ${listPrimitives()
        .map((p) => p.id)
        .join(', ')}.`,
    });
    expect(result.errors).toContainEqual({
      path: '$.scenes[0].patterns[0].pattern',
      code: 'unknown_reference',
      message: 'Unknown pattern "flood_then_funnel". No patterns exist yet.',
    });
  });

  it('passes the rate-limiter fixture except for its pattern, which waits for P1A.8', () => {
    const result = check(fixtureSpec());
    expect(result.errors).toEqual([
      expect.objectContaining({ path: '$.scenes[0].patterns[0].pattern' }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('warns about asset ids that are not in the asset registry, without failing the spec', () => {
    const input = registryValidSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, {
      props: { title: 'Client', icon: 'rocket_ship' },
    });
    const result = check(input);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      path: '$.scenes[0].elements[0].props.icon',
      code: 'unknown_asset',
    });
    expect(result.warnings[0]?.message).toMatch(
      /^Unknown asset "rocket_ship" .*Use one of: server, /,
    );
  });

  it('accepts asset ids from the built-in set', () => {
    const input = registryValidSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, {
      props: { title: 'Client', icon: 'smartphone' },
    });
    expect(check(input).warnings).toEqual([]);
  });

  it('reports asset warnings alongside errors when the spec is invalid', () => {
    const input = registryValidSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, {
      props: { title: 'Client', icon: 'nope' },
    });
    Object.assign(input.scenes[0]?.elements?.[2] ?? {}, { primitive: 'node_box' });
    const result = check(input);
    expect(result.ok).toBe(false);
    expect(result.warnings.map((w) => w.code)).toEqual(['unknown_asset']);
  });

  it('rejects bad props with a JSON path into the props', () => {
    const input = registryValidSpec();
    const reply = input.scenes[2]?.elements?.[1];
    Object.assign(reply ?? {}, { props: { text: 'x'.repeat(40), colour: 'red' } });
    const errors = check(input).errors;
    expect(errors).toContainEqual(
      expect.objectContaining({ path: '$.scenes[2].elements[1].props', code: 'unrecognized_keys' }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: '$.scenes[2].elements[1].props.text', code: 'too_big' }),
    );
    expect(errors).toHaveLength(2);
  });

  it('rejects a missing required prop and a wrong type', () => {
    const input = registryValidSpec();
    const [counter] = input.scenes[2]?.elements ?? [];
    Object.assign(counter ?? {}, { props: { unit: 7 } });
    const paths = check(input).errors.map((e) => e.path);
    expect(paths).toEqual([
      '$.scenes[2].elements[0].props.value',
      '$.scenes[2].elements[0].props.unit',
    ]);
  });

  it('rejects actions a target does not support, including targets inherited from the previous beat', () => {
    const input = registryValidSpec();
    input.scenes[2]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'count',
      targets: ['reply'],
    });
    input.scenes[1]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'count',
      targets: ['api'],
    });
    const errors = check(input).errors;
    expect(errors).toEqual([
      {
        path: '$.scenes[1].events[4].targets[0]',
        code: 'unsupported_action',
        message:
          '"api" (node_card) does not support "count". Supported: enter, exit, highlight, dim, pulse, lock, reject.',
      },
      expect.objectContaining({
        path: '$.scenes[2].events[4].targets[0]',
        code: 'unsupported_action',
      }),
    ]);
  });

  it('flags `lock` on a tag', () => {
    const input = registryValidSpec();
    Object.assign(input.scenes[2]?.events?.[3] ?? {}, { action: 'lock' });
    expect(check(input).errors).toContainEqual(
      expect.objectContaining({
        path: '$.scenes[2].events[3].targets[0]',
        code: 'unsupported_action',
      }),
    );
  });

  it('checks pattern params and pattern actions against a registered pattern', () => {
    const input = registryValidSpec();
    input.scenes[0]?.patterns?.push({
      id: 'bounce',
      pattern: 'test_bounce',
      params: { label: '' },
    });
    input.scenes[0]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'pulse',
      targets: ['bounce'],
    });
    const errors = check(input, withPatterns).errors;
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['$.scenes[0].patterns[0].params.label', 'too_small'],
      ['$.scenes[0].patterns[0].params.at', 'invalid_type'],
      ['$.scenes[0].events[5].targets[0]', 'unsupported_action'],
    ]);
  });

  it('adds registry errors to a spec that failed only on cross-references', () => {
    const input = fixtureSpec();
    input.scenes[0]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'enter',
      targets: ['ghost'],
    });
    const base = validateVideoSpec(input);
    expect(base.ok).toBe(false);
    const result = withRegistryChecks(base, input);
    expect(result.errors.slice(0, base.errors.length)).toEqual(base.errors);
    expect(result.errors.map((e) => e.code)).toContain('unknown_reference');
    expect(result.errors.length).toBeGreaterThan(base.errors.length);
  });

  it('leaves a result alone when the spec structure does not parse', () => {
    const base = validateVideoSpec({ schemaVersion: 1 });
    expect(withRegistryChecks(base, { schemaVersion: 1 })).toBe(base);
  });

  it('keeps warnings when registry errors make a valid spec invalid', () => {
    const input = fixtureSpec();
    const base = validateVideoSpec(input);
    expect(withRegistryChecks(base, input).warnings).toEqual(base.warnings);
  });
});

describe('parts', () => {
  /** The valid spec with a seat grid in beat 0 and an event at `scenes[0].events[5]`. */
  const withSeats = (event: Record<string, unknown>) => {
    const input = registryValidSpec();
    input.scenes[0]?.elements?.push({
      id: 'seats',
      primitive: 'slot_grid',
      props: {
        kind: 'seats',
        slots: [
          { id: 'h3', label: 'H3' },
          { id: 'h4', label: 'H4' },
        ],
      },
    });
    input.scenes[0]?.events?.push({
      at: { type: 'word', index: 0 },
      targets: ['seats'],
      ...event,
    } as never);
    return input;
  };

  it('accepts events on known parts with a part action', () => {
    const result = check(withSeats({ action: 'lock', params: { parts: ['h3', 'h4'] } }));
    expect(result.errors).toEqual([]);
  });

  it('checks the action against the part actions, not the element actions', () => {
    expect(check(withSeats({ action: 'lock' })).errors).toEqual([
      expect.objectContaining({
        path: '$.scenes[0].events[5].targets[0]',
        code: 'unsupported_action',
      }),
    ]);
    expect(check(withSeats({ action: 'count', params: { parts: ['h3'] } })).errors).toEqual([
      {
        path: '$.scenes[0].events[5].action',
        code: 'unsupported_action',
        message:
          'Parts of "seats" (slot_grid) do not support "count". ' +
          'Supported: enter, exit, lock, highlight, reject, pulse, dim.',
      },
    ]);
  });

  it('rejects unknown part ids, listing the valid ones', () => {
    expect(check(withSeats({ action: 'lock', params: { parts: ['h3', 'z9'] } })).errors).toEqual([
      {
        path: '$.scenes[0].events[5].params.parts[1]',
        code: 'unknown_part',
        message: '"seats" has no part "z9". Its parts: h3, h4.',
      },
    ]);
  });

  it('rejects parts on a target without parts, on several targets, and malformed parts', () => {
    const onCard = withSeats({ action: 'lock', params: { parts: ['h3'] } });
    Object.assign(onCard.scenes[0]?.events?.[5] ?? {}, { targets: ['api'] });
    expect(check(onCard).errors).toEqual([
      expect.objectContaining({ path: '$.scenes[0].events[5].params.parts', code: 'unknown_part' }),
    ]);
    const two = withSeats({ action: 'lock', params: { parts: ['h3'] } });
    Object.assign(two.scenes[0]?.events?.[5] ?? {}, { targets: ['seats', 'api'] });
    expect(check(two).errors.map((e) => e.code)).toEqual(['parts_need_one_target']);
    const bad = withSeats({ action: 'lock', params: { parts: [] } });
    expect(check(bad).errors.map((e) => [e.path, e.code])).toEqual([
      ['$.scenes[0].events[5].params.parts', 'too_small'],
    ]);
  });

  it('finds parts of elements inherited through continuesPrevious', () => {
    const input = withSeats({ action: 'lock', params: { parts: ['h3'] } });
    input.scenes[1]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'exit',
      targets: ['seats'],
      params: { parts: ['h4'] },
    });
    expect(check(input).errors).toEqual([]);
  });
});

describe('label caps', () => {
  it.each([
    ['conveyor_queue', { items: [{ id: 'o1', label: 'ORD-4211' }] }, 'items'],
    ['slot_grid', { slots: [{ id: 's1', label: 'SEAT-H12' }] }, 'slots'],
  ])('rejects an 8-character %s label with a repairable error', (primitive, props, list) => {
    const input = registryValidSpec();
    input.scenes[0]?.elements?.push({ id: 'capped', primitive, props });
    expect(check(input).errors).toEqual([
      {
        path: `$.scenes[0].elements[3].props.${list}[0].label`,
        code: 'too_big',
        message: 'Too big: expected string to have <=7 characters',
      },
    ]);
  });
});

describe('element refs', () => {
  const withElements = (...elements: Record<string, unknown>[]) => {
    const input = registryValidSpec();
    input.scenes[0]?.elements?.push(...elements);
    return input;
  };

  it('accepts refs to elements in the beat', () => {
    const link = { id: 'link', primitive: 'connector', props: { from: 'client', to: 'api' } };
    const flow = { id: 'flow', primitive: 'packet_stream', props: { along: 'link' } };
    expect(check(withElements(link, flow)).errors).toEqual([]);
  });

  it('rejects refs to missing elements, to itself, and to the wrong primitive', () => {
    const link = { id: 'link', primitive: 'connector', props: { from: 'client', to: 'ghost' } };
    const flow = { id: 'flow', primitive: 'packet_stream', props: { along: 'api' } };
    const grid = {
      id: 'grid',
      primitive: 'grid_overlay',
      props: { rows: 2, cols: 2, over: 'grid' },
    };
    const errors = check(withElements(link, flow, grid)).errors;
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['$.scenes[0].elements[3].props.to', 'unknown_element'],
      ['$.scenes[0].elements[4].props.along', 'invalid_element_ref'],
      ['$.scenes[0].elements[5].props.over', 'invalid_element_ref'],
    ]);
    expect(errors[0]?.message).toBe(
      'No element "ghost" in this beat. In scope: client, api, rps, flow, grid.',
    );
    expect(errors[1]?.message).toBe('"api" is a node_card; expected connector.');
    expect(errors[2]?.message).toBe('"grid" cannot point to itself.');
  });

  it('resolves refs to elements of a beat it continues', () => {
    const input = registryValidSpec();
    input.scenes[1]?.elements?.push({
      id: 'link',
      primitive: 'connector',
      props: { from: 'client', to: 'bucket' },
    });
    expect(check(input).errors).toEqual([]);
  });
});

describe('findRegistryErrors', () => {
  it('is empty for a spec without scenes', () => {
    const input: Record<string, unknown> = registryValidSpec();
    delete input.scenes;
    const result = validateVideoSpec(input);
    expect(result.ok && findRegistryErrors(result.spec)).toEqual([]);
  });
});
