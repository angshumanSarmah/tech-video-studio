import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  insetRevealBoardSpec,
  primitivesBoardSpec,
  spatialFlowBoardSpec,
} from '../../fixtures/index.ts';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import {
  ACTION_DURATION_SEC,
  DRAW_MAX_SEC,
  DRAW_MIN_SEC,
  drawDurationSec,
  drawLevels,
  PEN_SPEED_PX_PER_SEC,
} from '../events/presets.ts';
import { beatWorld, type WorldItem } from '../scene/beat-world.ts';
import { WorldItemView } from '../scene/WorldItemView.tsx';
import { getTheme, semanticTint, type Theme } from '../theme/index.ts';
import { borderOutline, outlineLength, shapeLength } from './outline.ts';

const FPS = 30;
const paper = getTheme('drafting-paper');
const paperFade: Theme = { ...paper, enter: { style: 'fade' } };

describe('borderOutline', () => {
  it('traces the middle of a CSS border: inset by half its width, radius less half', () => {
    expect(borderOutline({ width: 200, height: 80 }, 12, 4, '#000')).toEqual({
      kind: 'rect',
      x: 2,
      y: 2,
      width: 196,
      height: 76,
      radius: 10,
      strokeWidth: 4,
      colour: '#000',
    });
    expect(borderOutline({ width: 50, height: 20 }, 1, 4, '#000').radius).toBe(0);
  });

  it('measures a rounded rectangle along its centreline', () => {
    const square = borderOutline({ width: 102, height: 102 }, 1, 2, '#000');
    expect(shapeLength(square)).toBe(400);
    const round = borderOutline({ width: 42, height: 42 }, 21, 2, '#000');
    expect(shapeLength(round)).toBeCloseTo(2 * Math.PI * 20);
  });
});

describe('draw durations', () => {
  it('follow a constant pen speed, clamped to the minimum and maximum', () => {
    expect(drawDurationSec(0)).toBe(DRAW_MIN_SEC);
    expect(drawDurationSec(0.65 * PEN_SPEED_PX_PER_SEC)).toBeCloseTo(0.65);
    expect(drawDurationSec(10_000)).toBe(DRAW_MAX_SEC);
  });

  it('give a tag about the minimum and a large card or map the maximum', () => {
    const tag = DEFAULT_REGISTRIES.primitives.get('tag');
    const map = DEFAULT_REGISTRIES.primitives.get('map_base');
    if (!tag?.outline || !map?.outline) throw new Error('tag and map_base have outlines');
    const tagProps = tag.propsSchema.parse({ text: '429' });
    const tagHints = tag.sizeHints(tagProps, paper);
    const tagBox = { width: tagHints.preferredWidth, height: tagHints.preferredHeight };
    expect(drawDurationSec(outlineLength(tag.outline(tagProps, tagBox, paper)))).toBe(DRAW_MIN_SEC);
    const mapProps = map.propsSchema.parse({});
    const mapBox = { width: 900, height: 700 };
    expect(drawDurationSec(outlineLength(map.outline(mapProps, mapBox, paper)))).toBe(DRAW_MAX_SEC);
  });

  it('draw the stroke first, then the fill, and finish together', () => {
    expect(drawLevels(0.5)).toMatchObject({ fill: 0 });
    expect(drawLevels(0.5).stroke).toBeGreaterThan(0.5);
    expect(drawLevels(0.9).stroke).toBe(1);
    expect(drawLevels(0.9).fill).toBeGreaterThan(0);
    expect(drawLevels(1)).toEqual({ progress: 1, stroke: 1, fill: 1 });
  });
});

describe('card outlines match their CSS border', () => {
  it('uses the surface border radius, width and colour', () => {
    const node = DEFAULT_REGISTRIES.primitives.get('node_card');
    const props = node?.propsSchema.parse({ title: 'API', semantic: 'focus' });
    const [shape] = node?.outline?.(props, { width: 300, height: 100 }, paper) ?? [];
    expect(shape).toEqual(
      borderOutline(
        { width: 300, height: 100 },
        paper.radius.md,
        paper.stroke.regular,
        semanticTint(paper, 'focus').border,
      ),
    );
  });
});

const world = (spec: RenderableVideoSpec, beatId: string, theme: Theme) =>
  beatWorld(spec, effectiveTiming(spec), beatId, FPS, DEFAULT_REGISTRIES, { theme });

const itemOf = (items: WorldItem[], key: string) => {
  const item = items.find((i) => i.key === key);
  if (item?.kind !== 'primitive') throw new Error(key);
  return item;
};

const view = (item: WorldItem, frame: number) =>
  renderToStaticMarkup(<WorldItemView theme={paper} item={item} frame={frame} fps={FPS} />);

describe.each([
  [primitivesBoardSpec, 'node-card'],
  [primitivesBoardSpec, 'tag'],
  [primitivesBoardSpec, 'stat-card'],
  [primitivesBoardSpec, 'data-block'],
  [insetRevealBoardSpec, 'callout'],
  [spatialFlowBoardSpec, 'map-base'],
  [spatialFlowBoardSpec, 'connector'],
] as const)('draw enter of %#: %s', (spec, key) => {
  const drawn = itemOf(world(spec, key, paper), key);
  const faded = itemOf(world(spec, key, paperFade), key);
  const enter = drawn.events.find((e) => e.action === 'enter' && e.drawSec !== undefined);
  const drawSec = enter?.drawSec;
  if (!enter || drawSec === undefined) throw new Error(`${key} draws on enter`);
  const settle = Math.max(drawSec, ACTION_DURATION_SEC.enter);
  const settled = enter.frame + Math.ceil(settle * FPS) + 1;

  it('looks exactly as without the draw style once the draw has ended', () => {
    expect(view(drawn, settled)).toBe(view(faded, settled));
  });

  it('is drawing in the middle of it', () => {
    const middle = enter.frame + Math.round((drawSec * FPS) / 3);
    const html = view(drawn, middle);
    if (key === 'connector') {
      expect(html).not.toBe(view(faded, middle));
    } else {
      expect(html).toMatch(/stroke-dashoffset/);
      expect(html).toMatch(/opacity:0[;"]/);
    }
  });
});
