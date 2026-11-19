import { validateRenderableVideoSpec, type VideoFormat } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs, layoutModesBoardSpec, withFormat } from '../../fixtures/index.ts';
import layoutModesBoardJson from '../../fixtures/layout-modes-board.json';
import { withRegistryChecks } from '../catalog/validate.ts';
import { exclusionZones, getTheme, listThemes, safeAreas } from '../theme/index.ts';
import { MAX_ZOOM } from './camera.ts';
import { applyRect } from './fit.ts';
import { CARD_ASPECT, formatAreas } from './format.ts';
import { bottom, inside, overlaps } from './rect.ts';
import { specLayout, specLayoutWarnings } from './spec-layout.ts';
import { expectValidBoard, theme } from './test-layout.ts';

const FORMATS: VideoFormat[] = ['full', 'card'];

describe('formatAreas', () => {
  it.each(listThemes().map((t) => t.id))('%s: full uses the safe areas', (id) => {
    const t = getTheme(id);
    const areas = formatAreas(t, 'full');
    expect(areas.board).toEqual(safeAreas(t).stage);
    expect(areas.boardWithHeadline).toEqual(safeAreas(t).stageWithHeadline);
    expect(areas.header).toBeNull();
  });

  it.each(listThemes().map((t) => t.id))(
    '%s: card puts a 16:9 window clear of every zone between header and bands',
    (id) => {
      const t = getTheme(id);
      const { board, header, headlineBand, subtitleBand, avoidZones } = formatAreas(t, 'card');
      expect(Math.abs(board.width / board.height - CARD_ASPECT)).toBeLessThan(0.01);
      for (const zone of exclusionZones(t)) expect(overlaps(board, zone)).toBe(false);
      expect(avoidZones).toEqual([]);
      expect(header && bottom(header)).toBeLessThanOrEqual(board.y);
      expect(headlineBand.y).toBeGreaterThanOrEqual(bottom(board));
      expect(subtitleBand.y).toBeGreaterThanOrEqual(bottom(headlineBand));
      for (const band of [headlineBand, subtitleBand]) {
        for (const zone of exclusionZones(t)) expect(overlaps(band, zone)).toBe(false);
      }
    },
  );
});

describe('the layout fixture', () => {
  it('is a valid spec with no registry errors or warnings', () => {
    const result = withRegistryChecks(
      validateRenderableVideoSpec(layoutModesBoardJson),
      layoutModesBoardJson,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('lays out every beat without layout warnings in the full format', () => {
    expect(specLayoutWarnings(layoutModesBoardSpec, theme)).toEqual([]);
  });

  it('only warns about small text in the card format’s smaller window', () => {
    const warnings = specLayoutWarnings(withFormat(layoutModesBoardSpec, 'card'), theme);
    expect(new Set(warnings.map((w) => w.code))).toEqual(new Set(['text_too_small']));
  });

  it('covers every layout mode', () => {
    const modes = new Set(specLayout(layoutModesBoardSpec, theme).chains.map((c) => c.board.mode));
    expect(modes.size).toBe(11);
  });
});

describe.each(FORMATS)('every fixture board, %s format', (format) => {
  it.each(allFixtureSpecs.map((s) => [s.meta.id, s] as const))(
    '%s: no overlaps, inside the frame, clear of the avoid zones; cameras too',
    (_id, base) => {
      const spec = withFormat(base, format);
      const result = specLayout(spec, theme);
      const avoidZones = result.areas.avoidZones;
      for (const chain of result.chains) {
        expectValidBoard(chain.board, { rect: chain.board.frame, avoidZones });
      }
      for (const beat of result.beats.values()) {
        const { scale } = beat.camera;
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(scale).toBeLessThanOrEqual(MAX_ZOOM + 1e-9);
      }
    },
  );
});

describe('specLayout', () => {
  it('keeps one placement per continuesPrevious chain, with a camera per beat', () => {
    const result = specLayout(layoutModesBoardSpec, theme);
    const first = result.beats.get('pipeline');
    const second = result.beats.get('pipeline-more');
    expect(first?.chain).toBe(second?.chain);
    expect(first?.camera).not.toEqual(second?.camera);
    // The first beat shows fewer elements, so its camera is closer.
    expect(first?.camera.scale).toBeGreaterThan(second?.camera.scale ?? Infinity);
  });

  it('frames the visible elements inside the board and clear of the avoid zones', () => {
    const spec = layoutModesBoardSpec;
    const result = specLayout(spec, theme);
    const beat = result.beats.get('pipeline');
    if (!beat) throw new Error('missing beat');
    const shown = beat.chain.board.items.filter((i) => ['upload', 'resize'].includes(i.key));
    for (const item of shown) {
      const onScreen = applyRect(beat.camera, item.rect);
      expect(inside(beat.chain.board.frame, onScreen)).toBe(true);
      for (const zone of result.areas.avoidZones) expect(overlaps(onScreen, zone)).toBe(false);
    }
  });

  it('reserves the footnote line for a whole chain when any beat has a source', () => {
    const script = layoutModesBoardSpec.script.map((s) =>
      s.beatId === 'pipeline-more' ? { ...s, source: 'Example notes, 2026' } : s,
    );
    const spec = { ...layoutModesBoardSpec, script };
    const result = specLayout(spec, theme);
    const chain = result.beats.get('pipeline')?.chain;
    expect(chain?.footnote).not.toBeNull();
    expect(bottom(chain?.board.frame ?? { x: 0, y: 0, width: 0, height: 0 })).toBeLessThanOrEqual(
      chain?.footnote?.y ?? -1,
    );
    expect(result.beats.get('cycle')?.chain.footnote).toBeNull();
  });

  it('is memoised per spec and theme, and deterministic', () => {
    expect(specLayout(layoutModesBoardSpec, theme)).toBe(specLayout(layoutModesBoardSpec, theme));
    const serialise = (s: object) =>
      JSON.stringify(
        specLayout(structuredClone(s) as typeof layoutModesBoardSpec, theme),
        (_k, v: unknown) => (v instanceof Map ? [...v.entries()] : v),
      );
    expect(serialise(layoutModesBoardSpec)).toBe(serialise(layoutModesBoardSpec));
  });
});
