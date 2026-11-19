import { validateRenderableVideoSpec, validateVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { patternFormats } from '../patterns/types.ts';
import { listPatterns } from '../patterns/registry.ts';
import { LAYOUT_MODE_IDS } from '../layout/modes.ts';
import { listPrimitives } from '../primitives/registry.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { fixtureSpec } from './test-specs.ts';
import { findRegistryErrors, withRegistryChecks } from './validate.ts';

const check = (input: unknown, registries: Registries = DEFAULT_REGISTRIES) =>
  withRegistryChecks(validateVideoSpec(input), input, registries);

const withPatterns: Registries = {
  ...DEFAULT_REGISTRIES,
  patterns: buildPatternRegistry([bouncePattern]),
};

describe('withRegistryChecks', () => {
  it('accepts a spec that only uses registered primitives with valid props and actions', () => {
    const input = fixtureSpec();
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
    Object.assign(input.scenes[3]?.patterns?.[0] ?? {}, { pattern: 'flood_and_funnel' });
    expect(check(input).errors).toContainEqual({
      path: '$.scenes[3].patterns[0].pattern',
      code: 'unknown_reference',
      message: `Unknown pattern "flood_and_funnel". Use one of: ${listPatterns()
        .map((p) => p.id)
        .join(', ')}.`,
    });
  });

  it('rejects an unknown layout mode, listing the valid ones', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[0] ?? {}, { layoutMode: 'spiral' });
    expect(check(input).errors).toContainEqual({
      path: '$.scenes[0].layoutMode',
      code: 'unknown_reference',
      message: `Unknown layout mode "spiral". Use one of: ${LAYOUT_MODE_IDS.join(', ')}.`,
    });
  });

  it('passes the rate-limiter fixture, pattern included, with no errors or warnings', () => {
    const result = check(fixtureSpec());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns about asset ids that are not in the asset registry, without failing the spec', () => {
    const input = fixtureSpec();
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
    const input = fixtureSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, {
      props: { title: 'Client', icon: 'smartphone' },
    });
    expect(check(input).warnings).toEqual([]);
  });

  it('reports asset warnings alongside errors when the spec is invalid', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, {
      props: { title: 'Client', icon: 'nope' },
    });
    Object.assign(input.scenes[0]?.elements?.[2] ?? {}, { primitive: 'node_box' });
    const result = check(input);
    expect(result.ok).toBe(false);
    expect(result.warnings.map((w) => w.code)).toEqual(['unknown_asset']);
  });

  it('rejects bad props with a JSON path into the props', () => {
    const input = fixtureSpec();
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
    const input = fixtureSpec();
    const [counter] = input.scenes[2]?.elements ?? [];
    Object.assign(counter ?? {}, { props: { unit: 7 } });
    const paths = check(input).errors.map((e) => e.path);
    expect(paths).toEqual([
      '$.scenes[2].elements[0].props.value',
      '$.scenes[2].elements[0].props.unit',
    ]);
  });

  it('rejects actions a target does not support, including targets inherited from the previous beat', () => {
    const input = fixtureSpec();
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
          '"api" (node_card) does not support "count". Supported: enter, exit, highlight, dim, pulse, lock, release, reject, recover.',
      },
      expect.objectContaining({
        path: '$.scenes[2].events[4].targets[0]',
        code: 'unsupported_action',
      }),
    ]);
  });

  it('flags `lock` on a tag', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[2]?.events?.[3] ?? {}, { action: 'lock' });
    expect(check(input).errors).toContainEqual(
      expect.objectContaining({
        path: '$.scenes[2].events[3].targets[0]',
        code: 'unsupported_action',
      }),
    );
  });

  it('checks pattern params and pattern actions against a registered pattern', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[0] ?? {}, {
      patterns: [{ id: 'bounce', pattern: 'test_bounce', params: { label: '' } }],
    });
    input.scenes[0]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'pulse',
      targets: ['bounce'],
    });
    const errors = check(input, withPatterns).errors.filter((e) =>
      e.path.startsWith('$.scenes[0]'),
    );
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
    Object.assign(input.scenes[0]?.elements?.[2] ?? {}, { props: { value: 'lots' } });
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
    const input = fixtureSpec();
    input.scenes[0]?.elements?.push({
      id: 'seats',
      primitive: 'slot_grid',
      props: {
        kind: 'seats',
        slots: [
          { id: 'k7', label: 'K7' },
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
    const result = check(withSeats({ action: 'lock', params: { parts: ['k7', 'h4'] } }));
    expect(result.errors).toEqual([]);
  });

  it('checks the action against the part actions, not the element actions', () => {
    expect(check(withSeats({ action: 'lock' })).errors).toEqual([
      expect.objectContaining({
        path: '$.scenes[0].events[5].targets[0]',
        code: 'unsupported_action',
      }),
    ]);
    expect(check(withSeats({ action: 'count', params: { parts: ['k7'] } })).errors).toEqual([
      {
        path: '$.scenes[0].events[5].action',
        code: 'unsupported_action',
        message:
          'Parts of "seats" (slot_grid) do not support "count". ' +
          'Supported: enter, exit, lock, release, highlight, reject, recover, pulse, dim.',
      },
    ]);
  });

  it('rejects unknown part ids, listing the valid ones', () => {
    expect(check(withSeats({ action: 'lock', params: { parts: ['k7', 'z9'] } })).errors).toEqual([
      {
        path: '$.scenes[0].events[5].params.parts[1]',
        code: 'unknown_part',
        message: '"seats" has no part "z9". Its parts: k7, h4.',
      },
    ]);
  });

  it('rejects parts on a target without parts, on several targets, and malformed parts', () => {
    const onCard = withSeats({ action: 'lock', params: { parts: ['k7'] } });
    Object.assign(onCard.scenes[0]?.events?.[5] ?? {}, { targets: ['api'] });
    expect(check(onCard).errors).toEqual([
      expect.objectContaining({ path: '$.scenes[0].events[5].params.parts', code: 'unknown_part' }),
    ]);
    const two = withSeats({ action: 'lock', params: { parts: ['k7'] } });
    Object.assign(two.scenes[0]?.events?.[5] ?? {}, { targets: ['seats', 'api'] });
    expect(check(two).errors.map((e) => e.code)).toEqual(['parts_need_one_target']);
    const bad = withSeats({ action: 'lock', params: { parts: [] } });
    expect(check(bad).errors.map((e) => [e.path, e.code])).toEqual([
      ['$.scenes[0].events[5].params.parts', 'too_small'],
    ]);
  });

  it('finds parts of elements inherited through continuesPrevious', () => {
    const input = withSeats({ action: 'lock', params: { parts: ['k7'] } });
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
    const input = fixtureSpec();
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
    const input = fixtureSpec();
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

  it('checks pins: a side of any element, the middle of a connector only', () => {
    const link = { id: 'link', primitive: 'connector', props: { from: 'client', to: 'api' } };
    const onSide = { id: 'hot', primitive: 'tag', props: { text: 'HOT', pin: { to: 'api' } } };
    const onLink = {
      id: 'hit',
      primitive: 'counter',
      props: { value: 1, pin: { to: 'link', side: 'middle' } },
    };
    const bad = {
      id: 'odd',
      primitive: 'callout',
      props: { text: 'Why?', pin: { to: 'api', side: 'middle' } },
    };
    const lost = {
      id: 'lost',
      primitive: 'timer_ring',
      props: { durationSec: 5, pin: { to: 'ghost', side: 'left' } },
    };
    const errors = check(withElements(link, onSide, onLink, bad, lost)).errors;
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['$.scenes[0].elements[6].props.pin.to', 'invalid_element_ref'],
      ['$.scenes[0].elements[7].props.pin.to', 'unknown_element'],
    ]);
  });

  it('resolves refs to elements of a beat it continues', () => {
    const input = fixtureSpec();
    input.scenes[1]?.elements?.push({
      id: 'link',
      primitive: 'connector',
      props: { from: 'client', to: 'bucket' },
    });
    expect(check(input).errors).toEqual([]);
  });
});

describe('containers, overlays and timeline warnings', () => {
  type Json = Record<string, unknown>;
  const word = (text: string) => ({ type: 'word_text', text });
  const ev = (action: string, target: string, text: string, params?: Json) => ({
    at: word(text),
    action,
    targets: [target],
    ...(params ? { params } : {}),
  });
  /** The rate-limiter fixture with extra elements and events on its first beat ("hook"). */
  const hook = (elements: Json[], events: Json[]) => {
    const input = fixtureSpec();
    const scene = input.scenes[0];
    scene?.elements?.push(...elements);
    scene?.events?.push(...(events as never[]));
    return input;
  };
  const note = { id: 'note', primitive: 'tag', props: { text: '429' } };
  const zoom = {
    id: 'zoom',
    primitive: 'inset_panel',
    props: { anchor: 'api', children: ['note'] },
  };
  const question = {
    id: 'question',
    primitive: 'statement_card',
    props: { lines: [{ id: 'ask', text: 'Why does it fall over?' }] },
  };
  const codes = (issues: { path: string; code: string }[]) => issues.map((i) => [i.path, i.code]);

  it('accepts an inset holding beat elements, with children acting after it enters', () => {
    const result = check(
      hook([note, zoom], [ev('enter', 'zoom', 'user'), ev('pulse', 'note', 'error')]),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns on child events before the container enters, one warning per event', () => {
    const result = check(
      hook([note, zoom], [ev('enter', 'zoom', 'user'), ev('pulse', 'note', 'sends')]),
    );
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toEqual([['$.scenes[0].events[6]', 'child_before_container']]);
    expect(result.warnings[0]?.message).toMatch(
      /"note" acts \(pulse\) before its container "zoom"/,
    );
  });

  it('rejects an overlay inside a container and an element in two containers', () => {
    const twice = { ...zoom, id: 'zoom2', props: { children: ['note', 'question'] } };
    const errors = check(hook([note, question, zoom, twice], [])).errors;
    expect(codes(errors)).toEqual([
      ['$.scenes[0].elements[6].props.children[0]', 'invalid_element_ref'],
      ['$.scenes[0].elements[6].props.children[1]', 'invalid_element_ref'],
    ]);
    expect(errors[0]?.message).toBe(
      '"note" is already inside "zoom"; an element sits in one container.',
    );
    expect(errors[1]?.message).toMatch(/"question" is an overlay \(statement_card\)/);
  });

  it('rejects an anchor that is also a child', () => {
    const self = { ...zoom, props: { anchor: 'note', children: ['note'] } };
    expect(codes(check(hook([note, self], [])).errors)).toEqual([
      ['$.scenes[0].elements[4].props.anchor', 'custom'],
    ]);
  });

  it('checks bracket parts against its target', () => {
    const leader = {
      id: 'leader',
      primitive: 'node_card',
      props: { title: 'Leader', role: 'crown' },
    };
    const ok = {
      id: 'brace',
      primitive: 'bracket',
      props: { targets: ['leader'], parts: ['role'], label: 'ROLE' },
    };
    expect(check(hook([leader, ok], [])).errors).toEqual([]);
    const missing = { ...ok, props: { ...ok.props, parts: ['nope'] } };
    const noParts = { ...ok, props: { ...ok.props, targets: ['api'] } };
    const errors = check(hook([leader, missing], [])).errors;
    expect(codes(errors)).toEqual([['$.scenes[0].elements[4].props.parts[0]', 'unknown_part']]);
    expect(codes(check(hook([leader, noParts], [])).errors)).toEqual([
      ['$.scenes[0].elements[4].props.parts', 'unknown_part'],
    ]);
  });

  it('warns when two overlays are visible at the same time', () => {
    const shown = [ev('enter', 'question', 'client'), ev('exit', 'question', 'falls')];
    const overlapping = check(
      hook([note, question, zoom], [...shown, ev('enter', 'zoom', 'slows')]),
    );
    expect(codes(overlapping.warnings)).toEqual([['$.scenes[0].elements[5]', 'overlay_overlap']]);
    expect(overlapping.warnings[0]?.message).toMatch(
      /"zoom" \(inset_panel\) shows while "question" \(statement_card\) is still visible/,
    );
    const inTurn = check(hook([note, question, zoom], [...shown, ev('enter', 'zoom', 'user')]));
    expect(inTurn.warnings).toEqual([]);
  });

  it('warns when an overlay with no enter overlaps another for the whole beat', () => {
    expect(codes(check(hook([note, question, zoom], [])).warnings)).toEqual([
      ['$.scenes[0].elements[5]', 'overlay_overlap'],
    ]);
  });

  it('accepts a focus event on any element or pattern instance in scope', () => {
    const result = check(hook([note], [ev('focus', 'note', 'slows'), ev('focus', 'api', 'error')]));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('checks the engine params: hold on highlights only, stagger is scan', () => {
    const fine = [
      ev('highlight', 'api', 'slows', { hold: true }),
      ev('pulse', 'api', 'error', { stagger: 'scan' }),
    ];
    expect(check(hook([], fine)).errors).toEqual([]);
    const bad = [
      ev('pulse', 'api', 'slows', { hold: true }),
      ev('pulse', 'api', 'error', { stagger: 'fast' }),
    ];
    expect(codes(check(hook([], bad)).errors)).toEqual([
      ['$.scenes[0].events[5].params.hold', 'invalid_event_param'],
      ['$.scenes[0].events[6].params.stagger', 'invalid_value'],
    ]);
  });

  it('warns when a scan is squeezed below a readable step by the next event', () => {
    const ids = Array.from({ length: 24 }, (_, i) => `s${i}`);
    const seats = {
      id: 'seats',
      primitive: 'slot_grid',
      props: { kind: 'seats', slots: ids.map((id) => ({ id, label: id })) },
    };
    const sweep = ev('pulse', 'seats', 'slows', { parts: ids, stagger: 'scan' });
    const squeezed = check(hook([seats], [sweep, ev('pulse', 'api', 'then')]));
    expect(codes(squeezed.warnings)).toEqual([
      ['$.scenes[0].events[5].params.stagger', 'scan_too_short'],
    ]);
    expect(squeezed.warnings[0]?.message).toMatch(/A scan over 24 items gets 0\.\d\d s per item/);
    const four = { ...seats, props: { kind: 'seats', slots: seats.props.slots.slice(0, 4) } };
    const roomy = ev('pulse', 'seats', 'slows', { parts: ['s0', 's3'], stagger: 'scan' });
    expect(check(hook([four], [roomy, ev('pulse', 'api', 'error')])).warnings).toEqual([]);
  });

  it('warns on a recover with no reject held before it, on the element or the part', () => {
    const fine = check(
      hook([], [ev('reject', 'client', 'slows'), ev('recover', 'client', 'error')]),
    );
    expect(fine.warnings).toEqual([]);
    const early = check(
      hook([], [ev('recover', 'client', 'client'), ev('reject', 'client', 'slows')]),
    );
    expect(codes(early.warnings)).toEqual([['$.scenes[0].events[5]', 'recover_without_reject']]);
    expect(early.warnings[0]?.message).toMatch(/"client" recovers with no reject held before it/);
    const twice = [
      ev('reject', 'client', 'slows'),
      ev('recover', 'client', 'falls'),
      ev('recover', 'client', 'error'),
    ];
    expect(codes(check(hook([], twice)).warnings)).toEqual([
      ['$.scenes[0].events[7]', 'recover_without_reject'],
    ]);
  });

  it('warns on a release with no lock held before it; parts are tracked apart', () => {
    const seats = {
      id: 'seats',
      primitive: 'slot_grid',
      props: {
        kind: 'seats',
        slots: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    };
    const part = (action: string, text: string, id: string) =>
      ev(action, 'seats', text, { parts: [id] });
    const fine = [part('lock', 'client', 'a'), part('release', 'slows', 'a')];
    expect(check(hook([seats], fine)).warnings).toEqual([]);
    const wrongPart = [part('lock', 'client', 'a'), part('release', 'slows', 'b')];
    const result = check(hook([seats], wrongPart));
    expect(codes(result.warnings)).toEqual([['$.scenes[0].events[6]', 'release_without_lock']]);
    expect(result.warnings[0]?.message).toMatch(/part "b" of "seats" releases with no lock/);
  });

  it('warns when a jumpy route has more moves than hops', () => {
    const route = {
      id: 'route',
      primitive: 'route_path',
      props: { stops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], mode: 'jumpy', mover: 'bike' },
    };
    const moves = ['client', 'sends', 'slows'].map((w) => ev('move', 'route', w));
    expect(check(hook([route], moves.slice(0, 2))).warnings).toEqual([]);
    expect(codes(check(hook([route], moves)).warnings)).toEqual([
      ['$.scenes[0].elements[3]', 'route_moves_exceed_stops'],
    ]);
  });
});

describe('findRegistryErrors', () => {
  it('is empty for a spec without scenes', () => {
    const input: Record<string, unknown> = fixtureSpec();
    delete input.scenes;
    const result = validateVideoSpec(input);
    expect(result.ok && findRegistryErrors(result.spec)).toEqual([]);
  });
});

describe('pattern instances', () => {
  type Mutable = Record<string, unknown>;
  const payoff = (input: ReturnType<typeof fixtureSpec>) =>
    input.scenes[3] as unknown as Mutable & {
      patterns: { params: Mutable & { at: Mutable; source: Mutable } }[];
      events: Mutable[];
    };
  const word = { type: 'word', index: 0 };

  it('lets spec events use only highlight, pulse and dim on an inner element', () => {
    const input = fixtureSpec();
    payoff(input).events.push(
      { at: word, action: 'pulse', targets: ['flood/rate'] },
      { at: word, action: 'reject', targets: ['flood/target'] },
    );
    const errors = check(input).errors;
    expect(errors).toEqual([
      {
        path: '$.scenes[3].events[3].targets[0]',
        code: 'unsupported_action',
        message:
          '"flood/target" (node_card) does not support "reject". Supported: highlight, dim, pulse.',
      },
    ]);
  });

  it('rejects an inner id that is not in the expansion, listing the ones that are', () => {
    const input = fixtureSpec();
    payoff(input).events.push({ at: word, action: 'pulse', targets: ['flood/queue'] });
    const [error] = check(input).errors;
    expect(error).toMatchObject({
      path: '$.scenes[3].events[2].targets[0]',
      code: 'unknown_reference',
    });
    expect(error?.message).toMatch(
      /^"flood" \(flood_then_funnel\) has no element "queue"\. Its elements: source, layer, target,/,
    );
  });

  it('keeps enter for the pattern itself: an instance event may not use it', () => {
    const input = fixtureSpec();
    payoff(input).events.push({ at: word, action: 'enter', targets: ['flood'] });
    expect(check(input).errors).toEqual([
      expect.objectContaining({
        path: '$.scenes[3].events[2].targets[0]',
        code: 'unsupported_action',
      }),
    ]);
  });

  it('checks the anchors in params.at against the beat narration', () => {
    const input = fixtureSpec();
    payoff(input).patterns[0]!.params.at.funnel = { type: 'word_text', text: 'bucketful' };
    expect(check(input).errors).toEqual([
      {
        path: '$.scenes[3].patterns[0].params.at.funnel',
        code: 'anchor_out_of_range',
        message: 'Occurrence 1 of "bucketful" is not in this beat\'s narration.',
      },
    ]);
  });

  it('reports params that expand into invalid elements', () => {
    const broken = {
      ...bouncePattern,
      expand: () => ({
        elements: [{ id: 'x', primitive: 'tag', props: { text: '' }, zone: 'left' }],
        events: [],
      }),
    };
    const registries = { ...DEFAULT_REGISTRIES, patterns: new Map([['test_bounce', broken]]) };
    const input = fixtureSpec();
    Object.assign(input.scenes[3] ?? {}, {
      patterns: [
        {
          id: 'flood',
          pattern: 'test_bounce',
          params: { label: 'held', at: { bounce: { type: 'word_text', text: 'front' } } },
        },
      ],
      events: [],
    });
    const errors = check(input, registries).errors;
    expect(errors).toEqual([
      expect.objectContaining({
        path: '$.scenes[3].patterns[0].params',
        code: 'invalid_pattern_expansion',
      }),
    ]);
    expect(errors[0]?.message).toMatch(
      /^test_bounce: these params expand badly: invalid props on "x"/,
    );
  });

  it('warns about unknown asset ids inside an expansion', () => {
    const input = fixtureSpec();
    payoff(input).patterns[0]!.params.source = { title: 'Client', icon: 'rocket_ship' };
    const result = check(input);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: '$.scenes[3].patterns[0].params', code: 'unknown_asset' }),
    ]);
    expect(result.warnings[0]?.message).toMatch(/^Unknown asset "rocket_ship" on "source"/);
  });

  function withCachePattern() {
    const input = fixtureSpec();
    payoff(input).patterns.push({
      id: 'cache',
      pattern: 'cache_hit_miss',
      params: {
        client: { title: 'Client' },
        near: { title: 'Cache' },
        far: { title: 'Database' },
        hitLatency: '2 ms',
        missLatency: '120 ms',
        at: {
          show: { type: 'word_text', text: 'limiter' },
          hit: { type: 'word_text', text: 'steady' },
          miss: { type: 'word_text', text: 'trickle' },
        },
      },
    } as never);
    return input;
  }

  it('warns when two patterns in a beat want different layout modes', () => {
    const result = check(withCachePattern());
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: '$.scenes[3].layoutMode', code: 'pattern_layout_conflict' }),
    ]);
    expect(result.warnings[0]?.message).toMatch(/\(pipeline, near_far\); the first one is used/);
  });

  it('lets an explicit scene layout mode settle the conflict', () => {
    const input = withCachePattern();
    payoff(input).layoutMode = 'two_column';
    expect(check(input).warnings).toEqual([]);
  });
});

describe('pattern formats', () => {
  it('warns when a pattern does not suit the video format', () => {
    const input = fixtureSpec();
    expect(check(input).warnings).toEqual([]);
    Object.assign(input.meta as object, { format: 'card' });
    const warnings = check(input).warnings;
    expect(warnings).toEqual([
      expect.objectContaining({
        path: '$.scenes[3].patterns[0]',
        code: 'pattern_format_mismatch',
      }),
    ]);
    expect(warnings[0]?.message).toMatch(
      /flood_then_funnel reads well only in full; this video is card/,
    );
  });

  it('narrows the formats by a params rule', () => {
    const pool = DEFAULT_REGISTRIES.patterns.get('worker_pool');
    if (!pool) throw new Error('worker_pool is registered');
    const params = pool.paramsSchema.parse(pool.example.params) as { workers: unknown[] };
    expect(patternFormats(pool, params)).toEqual(['full', 'card']);
    const three = { ...params, workers: [...params.workers, ...params.workers].slice(0, 3) };
    expect(patternFormats(pool, three)).toEqual(['full']);
  });

  it('allows split_brain in the card format only without its lease timer', () => {
    const split = DEFAULT_REGISTRIES.patterns.get('split_brain');
    if (!split) throw new Error('split_brain is registered');
    const withLease = split.paramsSchema.parse(split.example.params) as Record<string, unknown>;
    expect(withLease.lease).toBeDefined();
    expect(patternFormats(split, withLease)).toEqual(['full']);
    const withoutLease = { ...withLease };
    delete withoutLease.lease;
    expect(patternFormats(split, withoutLease)).toEqual(['full', 'card']);
  });

  it('every pattern declares the formats it suits', () => {
    for (const p of listPatterns()) expect(p.formats.length).toBeGreaterThan(0);
  });
});
