/**
 * SVG path data (`d`) for the asset sanitizer (P1C.12): parsed strictly into absolute points so
 * a shape's extent can be checked against the house box, and written back with rounded numbers.
 * Curves and arcs are sampled (not their control points), so a drawing that stays inside the
 * box is never refused for a control point outside it. Pure.
 */

export type PathSegment = { readonly command: string; readonly args: readonly number[] };
export type Point = { readonly x: number; readonly y: number };

const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};
const CURVE_SAMPLES = 16;

/** The segments of `d`, or a reason it is not valid path data. */
export function parsePathData(d: string): { segments: PathSegment[] } | { problem: string } {
  const segments: PathSegment[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++;
  };
  const number = (): number | undefined => {
    skip();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!match) return undefined;
    i += match[0].length;
    return Number(match[0]);
  };
  const flag = (): number | undefined => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') return undefined;
    i++;
    return Number(c);
  };
  skip();
  while (i < d.length) {
    const command = d[i]!;
    const arity = ARITY[command.toUpperCase()];
    if (arity === undefined) return { problem: `Unknown path command "${command}".` };
    if (segments.length === 0 && command.toUpperCase() !== 'M') {
      return { problem: 'Path data must start with M.' };
    }
    i++;
    let first = true;
    do {
      const args: number[] = [];
      for (let k = 0; k < arity; k++) {
        const isFlag = command.toUpperCase() === 'A' && (k === 3 || k === 4);
        const value = isFlag ? flag() : number();
        if (value === undefined || !Number.isFinite(value)) {
          return { problem: `Path command "${command}" needs ${arity} numbers.` };
        }
        args.push(value);
      }
      // A moveto's extra pairs are linetos.
      const name = !first && command === 'M' ? 'L' : !first && command === 'm' ? 'l' : command;
      segments.push({ command: name, args });
      first = false;
      skip();
    } while (arity > 0 && i < d.length && !/[a-zA-Z]/.test(d[i]!));
    skip();
  }
  return { segments };
}

/** Points along the path (ends, plus samples on curves and arcs), in absolute coordinates. */
export function pathPoints(segments: readonly PathSegment[]): Point[] {
  const points: Point[] = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastControl: Point | undefined;
  for (const { command, args } of segments) {
    const rel = command === command.toLowerCase();
    const at = (x: number, y: number): Point => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    const upper = command.toUpperCase();
    let control: Point | undefined;
    let end: Point;
    if (upper === 'M') {
      end = at(args[0]!, args[1]!);
      start = end;
    } else if (upper === 'L' || upper === 'T') {
      end = at(args[0]!, args[1]!);
    } else if (upper === 'H') {
      end = { x: rel ? cur.x + args[0]! : args[0]!, y: cur.y };
    } else if (upper === 'V') {
      end = { x: cur.x, y: rel ? cur.y + args[0]! : args[0]! };
    } else if (upper === 'Z') {
      end = start;
    } else if (upper === 'C' || upper === 'S') {
      const c1 =
        upper === 'C'
          ? at(args[0]!, args[1]!)
          : lastControl
            ? { x: 2 * cur.x - lastControl.x, y: 2 * cur.y - lastControl.y }
            : cur;
      const offset = upper === 'C' ? 2 : 0;
      const c2 = at(args[offset]!, args[offset + 1]!);
      end = at(args[offset + 2]!, args[offset + 3]!);
      points.push(...sampleCubic(cur, c1, c2, end));
      control = c2;
    } else if (upper === 'Q') {
      const c = at(args[0]!, args[1]!);
      end = at(args[2]!, args[3]!);
      points.push(...sampleCubic(cur, lerp(cur, c, 2 / 3), lerp(end, c, 2 / 3), end));
      control = c;
    } else {
      end = at(args[5]!, args[6]!);
      points.push(...sampleArc(cur, end, args));
    }
    // A moveto draws nothing from where the pen was.
    if (upper === 'M') points.push(end);
    else points.push(cur, end);
    cur = end;
    lastControl = control;
  }
  return points;
}

/** `d` written back with every number rounded to two decimals. */
export function roundedPathData(segments: readonly PathSegment[]): string {
  return segments
    .map(({ command, args }) => `${command}${args.map((n) => String(round2(n))).join(' ')}`)
    .join('');
}

export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** True when some number of `d` has more than two decimals. */
export function hasLongDecimals(segments: readonly PathSegment[]): boolean {
  return segments.some((s) => s.args.some((n) => round2(n) !== n));
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  return Array.from({ length: CURVE_SAMPLES - 1 }, (_, k) => {
    const t = (k + 1) / CURVE_SAMPLES;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const e = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
    };
  });
}

/** Points on an elliptical arc (SVG endpoint to centre parameterisation, radii scaled up). */
function sampleArc(from: Point, to: Point, args: readonly number[]): Point[] {
  let rx = Math.abs(args[0]!);
  let ry = Math.abs(args[1]!);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) return [];
  const phi = (args[2]! * Math.PI) / 180;
  const large = args[3] === 1;
  const sweep = args[4] === 1;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = 2 * CURVE_SAMPLES;
  return Array.from({ length: steps - 1 }, (_, k) => {
    const t = theta + (delta * (k + 1)) / steps;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy };
  });
}
