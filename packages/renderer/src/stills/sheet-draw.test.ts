import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { patternBoardSpecs, primitiveBoardSpecs } from '../../fixtures/index.ts';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { listPatterns } from '../patterns/registry.ts';
import { elementState, type ElementEvent } from '../primitives/element-state.ts';
import { listPrimitives } from '../primitives/registry.ts';
import { beatWorld, type WorldItem } from '../scene/beat-world.ts';
import { getTheme } from '../theme/index.ts';
import { planPatternSheet } from './pattern-sheet.ts';
import { planPrimitiveSheet, type SheetPanel } from './primitive-sheet.ts';
import { settleDraws } from './sheet-draw.ts';

const FPS = 30;
const theme = getTheme('drafting-paper');

const flat = (items: readonly WorldItem[]): WorldItem[] =>
  items.flatMap((i) => [i, ...(i.kind === 'primitive' ? flat(i.children) : [])]);

function midDraw(spec: RenderableVideoSpec, beatId: string, panels: readonly SheetPanel[]) {
  const world = beatWorld(spec, effectiveTiming(spec), beatId, FPS, DEFAULT_REGISTRIES, { theme });
  return settleDraws(panels, world, FPS).flatMap((panel) =>
    flat(world).flatMap((item) =>
      item.kind === 'primitive' &&
      elementState(item.events, panel.frame, FPS, item.focus).draw.progress < 1
        ? [`${panel.caption}: ${item.key}`]
        : [],
    ),
  );
}

describe('settleDraws', () => {
  const item = (events: ElementEvent[]): WorldItem[] => {
    const definition = DEFAULT_REGISTRIES.primitives.get('tag');
    if (!definition) throw new Error('tag');
    return [
      {
        kind: 'primitive',
        key: 'tag',
        definition,
        props: {},
        events,
        focus: { focus: [], overlay: [] },
        layer: 'board',
        children: [],
      },
    ];
  };
  const draw = (sec: number): ElementEvent => ({
    action: 'enter',
    sec,
    frame: sec * FPS,
    beatEndSec: 10,
    drawSec: 0.5,
  });

  it('moves a panel to the end of a draw that ends before the next moment', () => {
    const panels = [{ caption: 'a', frame: 40, before: 60 }];
    expect(settleDraws(panels, item([draw(1.2)]), FPS)[0]?.frame).toBe(51);
    expect(settleDraws(panels, item([draw(1.8)]), FPS)[0]?.frame).toBe(40);
    expect(settleDraws(panels, item([]), FPS)[0]?.frame).toBe(40);
  });
});

describe('sheet panels in the draw style', () => {
  it.each(listPrimitives().map((p) => p.id))('%s: no element is still drawing', (id) => {
    const spec = primitiveBoardSpecs.find((s) => planPrimitiveSheet(s, id, FPS));
    const plan = spec && planPrimitiveSheet(spec, id, FPS);
    if (!spec || !plan) throw new Error(id);
    expect(midDraw(spec, plan.beatId, plan.panels)).toEqual([]);
  });

  it.each(listPatterns().map((p) => p.id))('%s: no element is still drawing', (id) => {
    const spec = patternBoardSpecs.find((s) => planPatternSheet(s, id, FPS, DEFAULT_REGISTRIES));
    const plan = spec && planPatternSheet(spec, id, FPS, DEFAULT_REGISTRIES);
    if (!spec || !plan) throw new Error(id);
    expect(midDraw(spec, plan.beatId, plan.panels)).toEqual([]);
  });
});
