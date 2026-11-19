import { describe, expect, it } from 'vitest';
import { column, row, single, wrap } from './blocks.ts';
import { applyRect, avoidConflicts, clearFrames, compose, fitTransform } from './fit.ts';
import { exitPoint, segmentCrossesRect } from './rect.ts';
import { separate } from './separate.ts';

const zone = { id: 'z', x: 900, y: 1000, width: 108, height: 480 };

describe('blocks', () => {
  it('lays blocks in rows and columns, centred, with gaps', () => {
    const r = row(
      [single('a', { width: 100, height: 50 }), single('b', { width: 100, height: 30 })],
      10,
    );
    expect(r.width).toBe(210);
    expect(r.rects.get('b')).toEqual({ x: 110, y: 10, width: 100, height: 30 });
    const c = column(
      [single('a', { width: 100, height: 50 }), single('b', { width: 60, height: 30 })],
      10,
    );
    expect(c.rects.get('b')).toEqual({ x: 20, y: 60, width: 60, height: 30 });
  });

  it('wraps rows at a maximum width', () => {
    const blocks = ['a', 'b', 'c'].map((k) => single(k, { width: 100, height: 20 }));
    const w = wrap(blocks, 220, 10);
    expect(w.height).toBe(50);
    expect(w.rects.get('c')?.y).toBe(30);
  });
});

describe('fit', () => {
  it('scales down to fit and centres, never scaling up', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100 };
    const down = fitTransform({ x: 0, y: 0, width: 200, height: 100 }, frame);
    expect(down.scale).toBe(0.5);
    expect(applyRect(down, { x: 0, y: 0, width: 200, height: 100 })).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(fitTransform({ x: 0, y: 0, width: 10, height: 10 }, frame).scale).toBe(1);
  });

  it('composes transforms', () => {
    const a = { scale: 2, dx: 10, dy: 0 };
    const b = { scale: 0.5, dx: 0, dy: 4 };
    const r = { x: 1, y: 1, width: 2, height: 2 };
    expect(applyRect(compose(a, b), r)).toEqual(applyRect(a, applyRect(b, r)));
  });

  it('finds rects and paths in avoid zones', () => {
    const shapes = {
      rects: new Map([
        ['in', { x: 950, y: 1100, width: 20, height: 20 }],
        ['out', { x: 100, y: 1100, width: 20, height: 20 }],
      ]),
      paths: new Map([
        [
          'line',
          [
            { x: 800, y: 1200 },
            { x: 1000, y: 1200 },
          ],
        ],
      ]),
    };
    expect(avoidConflicts(shapes, [zone])).toEqual(['in', 'line']);
  });

  it('offers the frame left of and above the zones', () => {
    const frame = { x: 72, y: 400, width: 936, height: 1080 };
    expect(clearFrames(frame, [zone], 24)).toEqual([
      { x: 72, y: 400, width: 804, height: 1080 },
      { x: 72, y: 400, width: 936, height: 576 },
    ]);
    expect(clearFrames(frame, [], 24)).toEqual([]);
  });
});

describe('rect helpers', () => {
  it('clips a segment at a rect edge', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    expect(exitPoint(r, { x: 50, y: 25 }, { x: 250, y: 25 })).toEqual({ x: 100, y: 25 });
  });

  it('tells when a segment passes through a rect', () => {
    const r = { x: 10, y: 10, width: 10, height: 10 };
    expect(segmentCrossesRect({ x: 0, y: 15 }, { x: 30, y: 15 }, r)).toBe(true);
    expect(segmentCrossesRect({ x: 0, y: 0 }, { x: 30, y: 0 }, r)).toBe(false);
  });
});

describe('separate', () => {
  it('pushes overlapping rects apart along the shorter axis', () => {
    const rects = new Map([
      ['a', { x: 0, y: 0, width: 100, height: 40 }],
      ['b', { x: 90, y: 5, width: 100, height: 40 }],
    ]);
    separate(rects, ['a', 'b'], 10);
    expect(rects.get('b')?.x).toBe(110);
    expect(rects.get('b')?.y).toBe(5);
  });
});
