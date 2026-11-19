import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo, type ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { patternBoardSpecs } from '../../fixtures/index.ts';
import { Background } from '../background/Background.tsx';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { getPattern } from '../patterns/registry.ts';
import type { Size } from '../primitives/types.ts';
import { beatWorld, type WorldItem } from '../scene/beat-world.ts';
import { itemBox, MARKER_SIZE, WorldItemView } from '../scene/WorldItemView.tsx';
import { DEFAULT_THEME_ID, getTheme, textCss, type Theme } from '../theme/index.ts';
import {
  fitScale,
  patternPanelRoom,
  planPatternSheet,
  rowsSize,
  zoneRows,
  type PatternSheetPlan,
  type ZoneRow,
} from './pattern-sheet.ts';
import type { SheetPanel } from './primitive-sheet.ts';

export type PatternSheetProps = { patternId: string; themeId: string };

export const patternSheetDefaults: PatternSheetProps = {
  patternId: 'atomic_lock',
  themeId: DEFAULT_THEME_ID,
};

/** Sampled at the final preset's rate; a still has no timeline of its own. */
const SHEET_FPS = 30;

/** Room for a zone label to the left of each row. */
const ZONE_LABEL_WIDTH = 150;

/**
 * Reference sheet for one pattern: its beat on the pattern board that has one, one panel per
 * narration anchor, each showing the whole beat at that moment with its elements in one row per
 * zone. Rendered to `docs/patterns/<id>.png` by `still:patterns`.
 */
export function PatternSheet({ patternId, themeId }: PatternSheetProps) {
  const theme = getTheme(themeId);
  loadThemeFonts(theme);
  const sheet = useMemo(() => buildSheet(patternId), [patternId]);
  return (
    <AbsoluteFill>
      <Background theme={theme} />
      <AbsoluteFill
        style={{
          padding: theme.space.xl,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.space.lg,
          color: theme.colours.ink.primary,
        }}
      >
        <Header theme={theme} patternId={patternId} layoutMode={sheet?.plan.layoutMode} />
        {sheet ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridAutoRows: '1fr',
              gap: theme.space.md,
            }}
          >
            {sheet.plan.panels.map((panel, i) => (
              <Panel
                key={i}
                theme={theme}
                panel={panel}
                rows={sheet.rows}
                room={patternPanelRoom(sheet.plan.panels.length)}
              />
            ))}
          </div>
        ) : (
          <div style={{ ...textCss(theme, 'title'), color: theme.colours.semantic.problem }}>
            No board beat for {patternId}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function buildSheet(patternId: string) {
  for (const spec of patternBoardSpecs) {
    const plan = planPatternSheet(spec, patternId, SHEET_FPS, DEFAULT_REGISTRIES);
    if (plan) return sheetFor(spec, plan);
  }
  return undefined;
}

function sheetFor(spec: RenderableVideoSpec, plan: PatternSheetPlan) {
  const world = beatWorld(spec, effectiveTiming(spec), plan.beatId, SHEET_FPS, DEFAULT_REGISTRIES);
  const zoned = world.map((item) =>
    item.kind === 'primitive' ? item : { ...item, zone: undefined },
  );
  return { plan, rows: zoneRows(zoned, plan.layoutMode) };
}

function Header(props: { theme: Theme; patternId: string; layoutMode: string | undefined }) {
  const { theme, patternId, layoutMode } = props;
  const definition = getPattern(patternId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs }}>
      <div style={{ ...textCss(theme, 'headline'), textTransform: 'none' }}>{patternId}</div>
      <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
        {definition?.family} · layout {layoutMode} · anchors{' '}
        {definition?.anchors.map((a) => a.name).join(' · ')}
      </div>
    </div>
  );
}

type Row = ZoneRow<WorldItem>;

function boxOf(item: WorldItem, theme: Theme): Size {
  return item.kind === 'primitive' ? itemBox(item, theme) : MARKER_SIZE;
}

/** One moment: every row at its natural size, scaled together to fit the panel. */
type PanelProps = { theme: Theme; panel: SheetPanel; rows: Row[]; room: Size };

function Panel({ theme, panel, rows, room }: PanelProps) {
  const gap = theme.space.lg;
  const sizes = rows.map((row) => [
    { width: ZONE_LABEL_WIDTH, height: 0 },
    ...row.items.map((item) => boxOf(item, theme)),
  ]);
  const natural = rowsSize(sizes, gap);
  return (
    <div
      style={{
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `${theme.stroke.hairline}px solid ${theme.colours.line}`,
        borderRadius: theme.radius.md,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          ...textCss(theme, 'label'),
          textTransform: 'none',
          padding: `${theme.space.xs}px ${theme.space.sm}px`,
          color: theme.colours.ink.muted,
          borderBottom: `${theme.stroke.hairline}px solid ${theme.colours.line}`,
        }}
      >
        {panel.caption}
      </div>
      <FitRows theme={theme} natural={natural} room={room}>
        {rows.map((row) => (
          <div key={row.zone} style={{ display: 'flex', alignItems: 'center', gap }}>
            <div
              style={{
                ...textCss(theme, 'label'),
                width: ZONE_LABEL_WIDTH,
                flexShrink: 0,
                color: theme.colours.ink.faint,
              }}
            >
              {row.zone}
            </div>
            {row.items.map((item) => (
              <div key={item.key} style={{ flexShrink: 0 }}>
                <WorldItemView theme={theme} item={item} frame={panel.frame} fps={SHEET_FPS} />
              </div>
            ))}
          </div>
        ))}
      </FitRows>
    </div>
  );
}

/** The rows at natural size, scaled down together to the panel's room and centred. */
function FitRows(props: { theme: Theme; natural: Size; room: Size; children: ReactNode }) {
  const { theme, natural, room, children } = props;
  const scale = fitScale(natural, room);
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.space.sm,
      }}
    >
      <div style={{ width: natural.width * scale, height: natural.height * scale, flexShrink: 0 }}>
        <div
          style={{
            width: natural.width,
            height: natural.height,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: theme.space.lg,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
