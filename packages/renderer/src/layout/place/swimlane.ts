import type { Point } from '../../primitives/geometry.ts';
import type { Rect } from '../../theme/index.ts';
import { column, combine, EMPTY_BLOCK, type Block, type Guide } from '../blocks.ts';
import { rectAt } from '../rect.ts';
import type { ModeContext, ModePlacer, Unit } from '../types.ts';
import { unitBlock, withAside, zoneUnits } from './common.ts';

/**
 * Vertical lanes, one per actor (`lane-1` … `lane-4`, its elements stacked at the lane's top), and
 * the `message` zone below them in spec order, one row per message. A message connector between
 * two lanes runs horizontally on its row from lifeline to lifeline (the mode routes it itself);
 * other message elements sit centred on their row. Lifelines are drawn as guides.
 */

export const LANE_ZONES = ['lane-1', 'lane-2', 'lane-3', 'lane-4'] as const;

type Lane = { block: Block; units: readonly Unit[] };

export const placeSwimlane: ModePlacer = (ctx) => {
  const lanes = LANE_ZONES.map((zone): Lane => {
    const units = zoneUnits(ctx, zone);
    return { units, block: units.length > 0 ? column(units.map(unitBlock), ctx.gap) : EMPTY_BLOCK };
  }).filter((lane) => lane.units.length > 0);
  if (lanes.length === 0) return withAside(ctx, messagesOnly(ctx));
  const laneWidth = Math.max(...lanes.map((l) => l.block.width));
  const header = Math.max(...lanes.map((l) => l.block.height));
  const centreX = (i: number) => i * (laneWidth + ctx.gap) + laneWidth / 2;
  const laneOf = new Map<string, number>();
  const rects = new Map<string, Rect>();
  lanes.forEach((lane, i) => {
    lane.block.rects.forEach((r, key) => {
      rects.set(key, { ...r, x: r.x + centreX(i) - lane.block.width / 2 });
      laneOf.set(key, i);
    });
  });
  const rowHeight = messageRowHeight(ctx);
  const rowY = (k: number) => header + ctx.linkGap + k * rowHeight + rowHeight / 2;
  const routes = new Map<string, readonly Point[]>();
  const middle = centreX((lanes.length - 1) / 2);
  messages(ctx).forEach((message, k) => {
    if (message.kind === 'unit') {
      rects.set(message.unit.key, rectAt({ x: middle, y: rowY(k) }, message.unit.size));
      return;
    }
    const from = laneOf.get(message.from);
    const to = laneOf.get(message.to);
    if (from === undefined || to === undefined || from === to) return;
    routes.set(message.key, [
      { x: centreX(from), y: rowY(k) },
      { x: centreX(to), y: rowY(k) },
    ]);
  });
  const count = messages(ctx).length;
  const end = count > 0 ? rowY(count - 1) + rowHeight / 2 : header + ctx.linkGap;
  const guides: Guide[] = lanes.map((lane, i) => ({
    from: { x: centreX(i), y: lane.block.height + ctx.gap / 2 },
    to: { x: centreX(i), y: end },
  }));
  return withAside(ctx, combine([{ ...EMPTY_BLOCK, rects, routes }], guides));
};

type Message =
  | { kind: 'unit'; unit: Unit; order: number }
  | { kind: 'link'; key: string; from: string; to: string; order: number };

/** Message elements and message connectors, in spec order. */
function messages(ctx: ModeContext): Message[] {
  const units: Message[] = zoneUnits(ctx, 'message').map((unit) => ({
    kind: 'unit',
    unit,
    order: unit.order,
  }));
  const links: Message[] = ctx.links
    .filter((l) => l.zone === 'message')
    .map((l) => ({ kind: 'link', key: l.key, from: l.from, to: l.to, order: l.order }));
  return [...units, ...links].sort((a, b) => a.order - b.order);
}

function messageRowHeight(ctx: ModeContext): number {
  const units = zoneUnits(ctx, 'message');
  return Math.max(2 * ctx.labelBand, ctx.linkGap, ...units.map((u) => u.size.height + ctx.gap));
}

/** Without lanes, message elements are a plain column. */
function messagesOnly(ctx: ModeContext): Block {
  return column(zoneUnits(ctx, 'message').map(unitBlock), ctx.gap);
}
