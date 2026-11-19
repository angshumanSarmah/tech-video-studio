import { validateRenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { patternBoardSpecs, patternFlowBoardSpec } from '../../fixtures/index.ts';
import patternFlowBoardJson from '../../fixtures/pattern-flow-board.json';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { withRegistryChecks } from '../catalog/validate.ts';
import { listPatterns } from '../patterns/registry.ts';
import {
  fitScale,
  patternPanelRoom,
  planPatternSheet,
  RELATIONS_ROW,
  rowsSize,
  zoneRows,
} from './pattern-sheet.ts';

const FPS = 30;

const boards = [['pattern-flow-board', patternFlowBoardJson]] as const;

describe.each(boards)('%s fixture', (_name, json) => {
  it('passes validation and the registry checks with no warnings', () => {
    const result = withRegistryChecks(validateRenderableVideoSpec(json), json);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("leaves every beat's layout mode to its pattern", () => {
    for (const scene of json.scenes) expect(scene).not.toHaveProperty('layoutMode');
  });
});

describe('pattern boards', () => {
  it.each(listPatterns().map((p) => [p.id, p] as const))(
    'have exactly one beat for %s, anchoring every declared moment',
    (id, pattern) => {
      const instances = patternBoardSpecs.flatMap((spec) =>
        spec.scenes.flatMap((s) => s.patterns.filter((p) => p.pattern === id)),
      );
      expect(instances, id).toHaveLength(1);
      expect(instances[0]?.id).toBe(id.replaceAll('_', '-'));
      const at = (instances[0]?.params as { at?: object }).at ?? {};
      expect(Object.keys(at).sort()).toEqual(pattern.anchors.map((a) => a.name).sort());
    },
  );
});

describe('planPatternSheet', () => {
  it('has one panel per anchor, in narration order, each sampled before the next', () => {
    const plan = planPatternSheet(patternFlowBoardSpec, 'atomic_lock', FPS, DEFAULT_REGISTRIES);
    expect(plan).toMatchObject({
      beatId: 'atomic-lock',
      instanceId: 'atomic-lock',
      layoutMode: 'hub_spoke',
    });
    expect(plan?.panels.map((p) => p.caption)).toEqual([
      'arrive · @"arrives"',
      'lock · @"locks"',
      'second · @"later"',
      'bounce · @"bounces"',
    ]);
    const frames = plan?.panels.map((p) => p.frame) ?? [];
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  it('returns undefined for a pattern no board uses', () => {
    expect(
      planPatternSheet(patternFlowBoardSpec, 'ghost', FPS, DEFAULT_REGISTRIES),
    ).toBeUndefined();
  });
});

describe('zoneRows', () => {
  it('groups items by zone in the mode order, relational items last, empty rows dropped', () => {
    const items = [
      { key: 'a', zone: 'sink' },
      { key: 'b', zone: 'source' },
      { key: 'c' },
      { key: 'd', zone: 'nowhere' },
      { key: 'e', zone: 'source' },
    ];
    const rows = zoneRows(items, 'pipeline');
    expect(rows.map((r) => [r.zone, r.items.map((i) => i.key)])).toEqual([
      ['source', ['b', 'e']],
      ['sink', ['a']],
      [RELATIONS_ROW, ['c', 'd']],
    ]);
  });
});

describe('sheet geometry', () => {
  it('sizes rows left to right and stacks them', () => {
    const rows = [
      [
        { width: 100, height: 50 },
        { width: 200, height: 80 },
      ],
      [{ width: 50, height: 20 }],
    ];
    expect(rowsSize(rows, 10)).toEqual({ width: 310, height: 110 });
  });

  it('scales down to fit and never enlarges', () => {
    expect(fitScale({ width: 2000, height: 100 }, { width: 1000, height: 400 })).toBe(0.5);
    expect(fitScale({ width: 100, height: 100 }, { width: 1000, height: 400 })).toBe(1);
  });

  it('shares the sheet height between panels', () => {
    expect(patternPanelRoom(5).height).toBeLessThan(patternPanelRoom(3).height);
    expect(patternPanelRoom(5).height).toBeGreaterThan(0);
  });
});
