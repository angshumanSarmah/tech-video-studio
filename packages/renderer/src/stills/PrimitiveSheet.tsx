import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo, type ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { primitiveBoardSpecs } from '../../fixtures/index.ts';
import { Background } from '../background/Background.tsx';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { getPrimitive } from '../primitives/registry.ts';
import { beatWorld } from '../scene/beat-world.ts';
import { itemBox, WorldItemView } from '../scene/WorldItemView.tsx';
import { settleDraws } from './sheet-draw.ts';
import { DEFAULT_THEME_ID, getTheme, textCss, type Theme } from '../theme/index.ts';
import {
  panelInner,
  planPrimitiveSheet,
  SHEET_COLUMNS,
  type SheetPanel,
  type SheetPlan,
} from './primitive-sheet.ts';

export type PrimitiveSheetProps = { primitiveId: string; themeId: string };

export const primitiveSheetDefaults: PrimitiveSheetProps = {
  primitiveId: 'node_card',
  themeId: DEFAULT_THEME_ID,
};

/** Sampled at the final preset's rate; a still has no timeline of its own. */
const SHEET_FPS = 30;

/**
 * Reference sheet for one primitive: its beat on the first primitive board that has one, one
 * panel per event, each drawn by the registered component at the state just before the next
 * event. Rendered to `docs/primitives/<id>.png` by `still:primitives`.
 */
export function PrimitiveSheet({ primitiveId, themeId }: PrimitiveSheetProps) {
  const theme = getTheme(themeId);
  loadThemeFonts(theme);
  const sheet = useMemo(() => buildSheet(primitiveId, theme), [primitiveId, theme]);
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
        <Header theme={theme} primitiveId={primitiveId} />
        {sheet ? (
          <div
            style={{
              flex: 1,
              display: 'grid',
              minHeight: 0,
              gridTemplateColumns: `repeat(${SHEET_COLUMNS}, 1fr)`,
              gridAutoRows: '1fr',
              gap: theme.space.md,
            }}
          >
            {sheet.panels.map((panel, i) => (
              <Panel
                key={i}
                theme={theme}
                panel={panel}
                item={sheet.item}
                inner={panelInner(sheet.panels.length)}
              />
            ))}
          </div>
        ) : (
          <div style={{ ...textCss(theme, 'title'), color: theme.colours.semantic.problem }}>
            No board beat for {primitiveId}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function buildSheet(primitiveId: string, theme: Theme) {
  for (const spec of primitiveBoardSpecs) {
    const plan = planPrimitiveSheet(spec, primitiveId, SHEET_FPS);
    if (plan) return sheetFor(spec, plan, theme);
  }
  return undefined;
}

function sheetFor(spec: RenderableVideoSpec, plan: SheetPlan, theme: Theme) {
  const world = beatWorld(spec, effectiveTiming(spec), plan.beatId, SHEET_FPS, DEFAULT_REGISTRIES, {
    theme,
  });
  const item = world.find((i) => i.key === plan.elementId);
  return item?.kind === 'primitive'
    ? { panels: settleDraws(plan.panels, world, SHEET_FPS), item }
    : undefined;
}

type Item = NonNullable<ReturnType<typeof buildSheet>>['item'];

function Header({ theme, primitiveId }: { theme: Theme; primitiveId: string }) {
  const definition = getPrimitive(primitiveId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs }}>
      <div style={{ ...textCss(theme, 'headline'), textTransform: 'none' }}>{primitiveId}</div>
      <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
        {definition?.family} · {definition?.actions.join(' · ')}
      </div>
    </div>
  );
}

type PanelProps = {
  theme: Theme;
  panel: SheetPanel;
  item: Item;
  inner: { width: number; height: number };
};

/**
 * One moment: the item at its preferred size (with any contained children inside it), scaled
 * down to fit the panel.
 */
function Panel({ theme, panel, item, inner }: PanelProps) {
  const box = itemBox(item, theme);
  return (
    <div
      style={{
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
      <FitBox theme={theme} width={box.width} height={box.height} inner={inner}>
        <WorldItemView theme={theme} item={item} frame={panel.frame} fps={SHEET_FPS} />
      </FitBox>
    </div>
  );
}

type FitBoxProps = {
  theme: Theme;
  width: number;
  height: number;
  inner: { width: number; height: number };
  children: ReactNode;
};

/** Scales the element down to fit the panel; the wrapper takes the scaled size, not the full box. */
function FitBox({ theme, width, height, inner, children }: FitBoxProps) {
  const scale = Math.min(1, inner.width / width, inner.height / height);
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.space.sm,
      }}
    >
      <div style={{ width: width * scale, height: height * scale, flexShrink: 0 }}>
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
