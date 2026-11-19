import {
  effectiveTiming,
  narrationWords,
  validateRenderableVideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import insetRevealBoardJson from '../../fixtures/inset-reveal-board.json';
import primitivesBoardJson from '../../fixtures/primitives-board.json';
import spatialFlowBoardJson from '../../fixtures/spatial-flow-board.json';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { withRegistryChecks } from '../catalog/validate.ts';
import { elementState } from '../primitives/element-state.ts';
import { beatWorld } from '../scene/beat-world.ts';
import { primitiveBoardSpecs, primitivesBoardSpec } from '../../fixtures/index.ts';
import { eventParts } from '../primitives/parts.ts';
import { listPrimitives } from '../primitives/registry.ts';
import { actionCaption, anchorCaption, panelInner, planPrimitiveSheet } from './primitive-sheet.ts';

const FPS = 30;

const boards = [
  ['primitives-board', primitivesBoardJson],
  ['spatial-flow-board', spatialFlowBoardJson],
  ['inset-reveal-board', insetRevealBoardJson],
] as const;

describe.each(boards)('%s fixture', (_name, json) => {
  it('passes validation and the registry checks with no warnings', () => {
    const result = withRegistryChecks(validateRenderableVideoSpec(json), json);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('exits at least one element', () => {
    const actions = json.scenes.flatMap((s) => s.events.map((e) => e.action));
    expect(actions).toContain('exit');
  });
});

describe('primitive boards', () => {
  const sceneFor = (id: string) =>
    primitiveBoardSpecs
      .flatMap((spec) => spec.scenes)
      .find((s) => s.elements.some((e) => e.primitive === id));

  it.each(listPrimitives().map((p) => [p.id, p] as const))(
    'have a beat for %s using every action it supports (exit at least once per board)',
    (id, primitive) => {
      const scene = sceneFor(id);
      expect(scene, id).toBeDefined();
      const element = scene?.elements.find((e) => e.primitive === id);
      const mine = scene?.events.filter((e) => element && e.targets.includes(element.id)) ?? [];
      const whole = new Set(mine.filter((e) => !eventParts(e.params)).map((e) => e.action));
      for (const action of primitive.actions) {
        if (action !== 'exit') expect(whole, `${id} · ${action}`).toContain(action);
      }
      const onParts = new Set(mine.filter((e) => eventParts(e.params)).map((e) => e.action));
      for (const action of primitive.parts?.actions ?? []) {
        expect(onParts, `${id} · part ${action}`).toContain(action);
      }
    },
  );

  it('give every primitive a beat on exactly one board', () => {
    for (const { id } of listPrimitives()) {
      const boardsWithIt = primitiveBoardSpecs.filter((spec) =>
        spec.scenes.some((s) =>
          s.elements.some((e) => e.primitive === id && e.id === id.replaceAll('_', '-')),
        ),
      );
      expect(boardsWithIt, id).toHaveLength(1);
    }
  });
});

describe('planPrimitiveSheet', () => {
  it('has one panel per event, in order, each sampled before the next event', () => {
    const plan = planPrimitiveSheet(primitivesBoardSpec, 'node_card', FPS);
    expect(plan?.beatId).toBe('node-card');
    expect(plan?.panels.map((p) => p.caption)).toEqual([
      '@"node" · enter',
      '@"crown" · pulse role',
      '@"steps" · exit role',
      '@"returns" · enter role',
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

  it('names the parts an event acts on', () => {
    const [board] = primitiveBoardSpecs.slice(1);
    if (!board) throw new Error('missing spatial board');
    const plan = planPrimitiveSheet(board, 'slot_grid', FPS);
    expect(plan?.panels.map((p) => p.caption)).toContain('@"locks" · lock b2');
    expect(actionCaption('lock', { parts: ['h3', 'h4'] })).toBe('lock h3+h4');
    expect(actionCaption('dim', undefined)).toBe('dim');
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

describe('panelInner', () => {
  it('keeps the full panel size for up to three rows, and shrinks it for more', () => {
    expect(panelInner(6)).toEqual({ width: 380, height: 400 });
    expect(panelInner(8).height).toBeLessThan(400);
    expect(panelInner(10).height).toBeLessThan(panelInner(8).height);
    expect(panelInner(10).height).toBeGreaterThan(150);
  });
});
