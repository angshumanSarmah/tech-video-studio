import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { stageForBeat } from '../hud/hud-state.ts';
import { rectCss } from '../layers/rect-css.ts';
import { componentFor } from '../primitives/components.ts';
import { elementState } from '../primitives/element-state.ts';
import type { Size } from '../primitives/types.ts';
import { safeAreas, semanticTint, textCss, type Theme } from '../theme/index.ts';
import { beatWorld, type WorldItem } from './beat-world.ts';

/**
 * One beat's board: every element drawn by its registered component, with state from its anchored
 * events. TEMPORARY placement: elements flow in a centred wrap inside the stage at their preferred
 * size until the layout engine (P1A.9) computes positions, sizes and focus.
 */

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  beatId: string;
  /** Global frame the beat's `<Sequence>` starts at. */
  beatFrom: number;
};

const MARKER_SIZE: Size = { width: 420, height: 120 };

export function BeatScene({ theme, spec, timing, beatId, beatFrom }: Props) {
  const frame = useCurrentFrame() + beatFrom;
  const { fps } = useVideoConfig();
  const items = useMemo(
    () => beatWorld(spec, timing, beatId, fps, DEFAULT_REGISTRIES),
    [spec, timing, beatId, fps],
  );
  const stage = stageForBeat(
    useMemo(() => safeAreas(theme), [theme]),
    spec,
    beatId,
  );
  return (
    <div
      style={{
        ...rectCss(stage),
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.lg,
      }}
    >
      {items.map((item) => (
        <Item key={item.key} theme={theme} item={item} frame={frame} fps={fps} />
      ))}
    </div>
  );
}

type ItemProps = { theme: Theme; item: WorldItem; frame: number; fps: number };

function Item({ theme, item, frame, fps }: ItemProps) {
  const Component = item.kind === 'primitive' ? componentFor(item.definition.id) : undefined;
  if (item.kind === 'error' || !Component) {
    const detail = item.kind === 'error' ? item.detail : item.definition.id;
    return (
      <ErrorMarker
        theme={theme}
        title={item.kind === 'error' ? item.title : 'No component'}
        detail={detail}
      />
    );
  }
  const hints = item.definition.sizeHints(item.props, theme);
  const box = { width: hints.preferredWidth, height: hints.preferredHeight };
  return (
    <Component
      theme={theme}
      props={item.props}
      box={box}
      state={elementState(item.events, frame, fps)}
    />
  );
}

/** Red, dashed and hatched: an error in the spec, never mistakable for content. */
function ErrorMarker({ theme, title, detail }: { theme: Theme; title: string; detail: string }) {
  const tint = semanticTint(theme, 'problem');
  return (
    <div
      style={{
        minWidth: MARKER_SIZE.width,
        minHeight: MARKER_SIZE.height,
        maxWidth: '100%',
        padding: theme.space.sm,
        boxSizing: 'border-box',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.xs,
        border: `${theme.stroke.regular}px dashed ${tint.base}`,
        background: `repeating-linear-gradient(45deg, ${tint.soft} 0 12px, transparent 12px 24px)`,
      }}
    >
      <div style={{ ...textCss(theme, 'label'), color: tint.base }}>✗ {title}</div>
      <div
        style={{
          ...textCss(theme, 'label'),
          textTransform: 'none',
          color: theme.colours.ink.primary,
        }}
      >
        {detail}
      </div>
    </div>
  );
}
