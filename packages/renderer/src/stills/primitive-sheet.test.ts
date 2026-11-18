import {
  effectiveTiming,
  narrationWords,
  validateRenderableVideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import primitivesBoardJson from '../../fixtures/primitives-board.json';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { withRegistryChecks } from '../catalog/validate.ts';
import { elementState } from '../primitives/element-state.ts';
import { beatWorld } from '../scene/beat-world.ts';
import { primitivesBoardSpec } from '../../fixtures/index.ts';
import { listPrimitives } from '../primitives/registry.ts';
import { anchorCaption, planPrimitiveSheet } from './primitive-sheet.ts';

const FPS = 30;

describe('primitives board fixture', () => {
  it('passes validation and the registry checks with no warnings', () => {
    const result = withRegistryChecks(
      validateRenderableVideoSpec(primitivesBoardJson),
      primitivesBoardJson,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it.each(listPrimitives().map((p) => [p.id, p] as const))(
    'has a beat for %s using every action it supports (exit at least once overall)',
    (id, primitive) => {
      const scene = primitivesBoardSpec.scenes.find((s) =>
        s.elements.some((e) => e.primitive === id),
      );
      expect(scene, id).toBeDefined();
      const used = new Set(scene?.events.map((e) => e.action));
      for (const action of primitive.actions) {
        if (action !== 'exit') expect(used, `${id} · ${action}`).toContain(action);
      }
    },
  );

  it('exits at least one element', () => {
    const actions = primitivesBoardSpec.scenes.flatMap((s) => s.events.map((e) => e.action));
    expect(actions).toContain('exit');
  });
});

describe('planPrimitiveSheet', () => {
  it('has one panel per event, in order, each sampled before the next event', () => {
    const plan = planPrimitiveSheet(primitivesBoardSpec, 'node_card', FPS);
    expect(plan?.beatId).toBe('node-card');
    expect(plan?.panels.map((p) => p.caption)).toEqual([
      '@"node" · enter',
      '@"lights" · highlight',
      '@"pulses" · pulse',
      '@"locks" · lock',
      '@"crashes" · reject',
      '@"dims" · dim',
    ]);
    const frames = plan?.panels.map((p) => p.frame) ?? [];
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  it('samples a pulse at its peak, not after it has faded', () => {
    const spec = primitivesBoardSpec;
    const plan = planPrimitiveSheet(spec, 'node_card', FPS);
    const item = beatWorld(spec, effectiveTiming(spec), 'node-card', FPS, DEFAULT_REGISTRIES).find(
      (i) => i.key === 'node-card',
    );
    const pulse = plan?.panels.find((p) => p.caption.endsWith('pulse'));
    if (item?.kind !== 'primitive' || !pulse) throw new Error('missing node card or pulse');
    const state = elementState(
      item.events.filter((e) => e.action !== 'highlight'),
      pulse.frame,
      FPS,
    );
    expect(state.emphasis).toBeGreaterThan(0.9);
  });

  it('returns undefined for a primitive with no board beat', () => {
    expect(planPrimitiveSheet(primitivesBoardSpec, 'not_a_primitive', FPS)).toBeUndefined();
  });
});

describe('anchorCaption', () => {
  const words = narrationWords('Burst too fast and the bucket runs dry.');

  it('names the anchor word or beat edge', () => {
    expect(anchorCaption({ type: 'word', index: 1 }, words)).toBe('@"too"');
    expect(anchorCaption({ type: 'word_text', text: 'dry', occurrence: 1 }, words)).toBe('@"dry"');
    expect(anchorCaption({ type: 'word_text', text: 'no', occurrence: 2 }, words)).toBe('@"no" ×2');
    expect(anchorCaption({ type: 'beat', edge: 'end', offsetSec: -0.5 }, words)).toBe('end-0.5s');
  });
});
