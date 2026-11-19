import type { ReactNode } from 'react';
import { componentFor } from '../primitives/components.ts';
import { elementState } from '../primitives/element-state.ts';
import type { Size } from '../primitives/types.ts';
import { semanticTint, textCss, type Theme } from '../theme/index.ts';
import type { WorldItem } from './beat-world.ts';
import { containedState, type PrimitiveItem } from './scene-layers.ts';

/**
 * One world item drawn by its registered component at its preferred size, with its contained
 * children drawn inside it (each scaled down to fit). Errors become red markers. Shared by
 * `BeatScene` and the primitive sheets, so both draw nesting and presence the same way.
 */

type Props = {
  theme: Theme;
  item: WorldItem;
  frame: number;
  fps: number;
  /** Presence of the container this item is drawn in; 1 on the board. */
  containerPresence?: number;
};

export const MARKER_SIZE: Size = { width: 420, height: 120 };

export function WorldItemView({ theme, item, frame, fps, containerPresence = 1 }: Props) {
  const Component = item.kind === 'primitive' ? componentFor(item.definition.id) : undefined;
  if (item.kind === 'error' || !Component) {
    const detail = item.kind === 'error' ? item.detail : item.definition.id;
    const title = item.kind === 'error' ? item.title : 'No component';
    return <ErrorMarker theme={theme} title={title} detail={detail} />;
  }
  const box = itemBox(item, theme);
  const state = containedState(elementState(item.events, frame, fps), containerPresence);
  const room = childRoom(theme, box, item.children.length);
  return (
    <Component theme={theme} props={item.props} box={box} state={state}>
      {item.children.map((child) => (
        <Fit
          key={child.key}
          size={child.kind === 'primitive' ? itemBox(child, theme) : MARKER_SIZE}
          room={room}
        >
          <WorldItemView
            theme={theme}
            item={child}
            frame={frame}
            fps={fps}
            containerPresence={state.presence}
          />
        </Fit>
      ))}
    </Component>
  );
}

/** An item's box: its preferred size (TEMPORARY until the layout engine, P1A.9). */
export function itemBox(item: PrimitiveItem, theme: Theme): Size {
  const hints = item.definition.sizeHints(item.props, theme);
  return { width: hints.preferredWidth, height: hints.preferredHeight };
}

/** Room each child gets inside a container: its width, and an equal share of its height. */
function childRoom(theme: Theme, box: Size, count: number): Size {
  const gaps = Math.max(0, count - 1) * theme.space.lg;
  return {
    width: box.width - 2 * theme.space.lg,
    height: (box.height - 2 * theme.space.xl - gaps) / Math.max(1, count),
  };
}

type FitProps = { size: Size; room: Size; children: ReactNode };

/** Scales a child down (never up) to fit `room`; the wrapper takes the scaled size. */
function Fit({ size, room, children }: FitProps) {
  const scale = Math.min(1, room.width / size.width, room.height / size.height);
  return (
    <div style={{ width: size.width * scale, height: size.height * scale, flexShrink: 0 }}>
      <div style={{ ...size, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
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
