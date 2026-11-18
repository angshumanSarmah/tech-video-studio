import { validateRenderableVideoSpec, validateVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { PRIMITIVES } from '../primitives/registry.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { fixtureSpec, registryValidSpec } from './test-specs.ts';
import { findRegistryErrors, withRegistryChecks } from './validate.ts';

const check = (input: unknown, registries: Registries = DEFAULT_REGISTRIES) =>
  withRegistryChecks(validateVideoSpec(input), input, registries);

const withPatterns: Registries = {
  primitives: PRIMITIVES,
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
    const result = check(fixtureSpec());
    expect(result.ok).toBe(false);
    expect(result.spec).toBeUndefined();
    expect(result.errors).toContainEqual({
      path: '$.scenes[0].elements[0].primitive',
      code: 'unknown_reference',
      message: 'Unknown primitive "node_card". Use one of: tag, counter.',
    });
    expect(result.errors).toContainEqual({
      path: '$.scenes[0].patterns[0].pattern',
      code: 'unknown_reference',
      message: 'Unknown pattern "flood_then_funnel". No patterns exist yet.',
    });
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
          '"api" (tag) does not support "count". Supported: enter, exit, highlight, dim, pulse, reject.',
      },
      expect.objectContaining({
        path: '$.scenes[2].events[4].targets[0]',
        code: 'unsupported_action',
      }),
    ]);
  });

  it('flags `lock` on a tag in the fixture', () => {
    expect(check(fixtureSpec()).errors).toContainEqual(
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

describe('findRegistryErrors', () => {
  it('is empty for a spec without scenes', () => {
    const input: Record<string, unknown> = registryValidSpec();
    delete input.scenes;
    const result = validateVideoSpec(input);
    expect(result.ok && findRegistryErrors(result.spec)).toEqual([]);
  });
});
