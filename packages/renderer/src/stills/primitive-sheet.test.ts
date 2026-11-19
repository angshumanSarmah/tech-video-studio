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

/** A board scene as the JSON imports type it, with the optional event params. */
type BoardScene = {
  beatId: string;
  events: { action: string; targets: string[]; params?: Record<string, unknown> }[];
};

describe.each(boards)('%s fixture', (_name, json) => {
  it('passes validation and the registry checks with no warnings', () => {
    const result = withRegistryChecks(validateRenderableVideoSpec(json), json);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  const scenes = json.scenes as BoardScene[];

  it('exits and recovers at least one element', () => {
    const events = scenes.flatMap((s) => s.events);
    expect(events.map((e) => e.action)).toContain('exit');
    expect(events.filter((e) => !eventParts(e.params)).map((e) => e.action)).toContain('recover');
  });

  it('recovers only what it rejected before', () => {
    for (const scene of scenes) {
      for (const [i, event] of scene.events.entries()) {
        if (event.action !== 'recover') continue;
        const parts = eventParts(event.params) ?? [];
        const same = scene.events
          .slice(0, i)
          .filter(
            (e) =>
              e.action === 'reject' &&
              e.targets.join() === event.targets.join() &&
              (eventParts(e.params) ?? []).join() === parts.join(),
          );
        expect(same, `${scene.beatId} · recover`).not.toHaveLength(0);
      }
    }
  });
});

/**
 * Exercised once per board rather than on every primitive's beat: exit, and recover and release,
 * whose looks are shared (the held reject or lock ends in `elementState`; components draw nothing
 * of their own for them).
 */
const ONCE_PER_BOARD: ReadonlySet<string> = new Set(['exit', 'recover', 'release']);

describe('primitive boards', () => {
  it('recover at least one part across the boards', () => {
    const partRecovers = primitiveBoardSpecs
      .flatMap((spec) => spec.scenes.flatMap((s) => s.events))
      .filter((e) => e.action === 'recover' && eventParts(e.params));
    expect(partRecovers.length).toBeGreaterThan(0);
  });

  it('release a whole element and a part across the boards', () => {
    const releases = primitiveBoardSpecs
      .flatMap((spec) => spec.scenes.flatMap((s) => s.events))
      .filter((e) => e.action === 'release');
    expect(releases.some((e) => !eventParts(e.params))).toBe(true);
    expect(releases.some((e) => eventParts(e.params))).toBe(true);
  });

  const sceneFor = (id: string) =>
    primitiveBoardSpecs
      .flatMap((spec) => spec.scenes)
      .find((s) => s.elements.some((e) => e.primitive === id));

  it.each(listPrimitives().map((p) => [p.id, p] as const))(
    'have a beat for %s using every action it supports (exit and recover once per board)',
    (id, primitive) => {
      const scene = sceneFor(id);
      expect(scene, id).toBeDefined();
      const element = scene?.elements.find((e) => e.primitive === id);
      const mine = scene?.events.filter((e) => element && e.targets.includes(element.id)) ?? [];
      const whole = new Set(mine.filter((e) => !eventParts(e.params)).map((e) => e.action));
      for (const action of primitive.actions) {
        if (!ONCE_PER_BOARD.has(action)) expect(whole, `${id} · ${action}`).toContain(action);
      }
      const onParts = new Set(mine.filter((e) => eventParts(e.params)).map((e) => e.action));
      for (const action of primitive.parts?.actions ?? []) {
        if (!ONCE_PER_BOARD.has(action))
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
      '@"releases" · release',
      '@"crashes" · reject',
      '@"recovers" · recover',
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
