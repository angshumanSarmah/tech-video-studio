import type { ReactNode } from 'react';
import { DrawReveal } from '../draw/DrawReveal.tsx';
import { boxOf, type PlacedItem } from '../layout/types.ts';
import { componentFor } from '../primitives/components.ts';
import { elementState } from '../primitives/element-state.ts';
import { dimmedTheme } from '../primitives/muted-text.ts';
import type { Size } from '../primitives/types.ts';
import { semanticTint, textCss, type Theme } from '../theme/index.ts';
import type { WorldItem } from './beat-world.ts';
import { MARKER_SIZE } from './marker.ts';
import { containedState, type PrimitiveItem } from './scene-layers.ts';

/**
 * One world item drawn by its registered component, with its contained children drawn inside it.
 * With a `placed` layout (on a board) it gets the layout's box and path, and its children go where
 * the layout put them; without one (primitive and pattern sheets) it takes its preferred size and
 * its children are scaled down to fit. Errors become red markers. Shared by `BeatScene` and the
 * sheets, so both draw nesting and presence the same way.
 */

type Props = {
  theme: Theme;
  item: WorldItem;
  frame: number;
  fps: number;
  /** Presence of the container this item is drawn in; 1 on the board. */
  containerPresence?: number;
  /** Where the layout put it (and its children); absent on sheets. */
  placed?: PlacedItem;
};

export { MARKER_SIZE };

export function WorldItemView({ theme, item, frame, fps, containerPresence = 1, placed }: Props) {
  const Component = item.kind === 'primitive' ? componentFor(item.definition.id) : undefined;
  if (item.kind === 'error' || !Component) {
    const detail = item.kind === 'error' ? item.detail : item.definition.id;
    const title = item.kind === 'error' ? item.title : 'No component';
    return <ErrorMarker theme={theme} title={title} detail={detail} />;
  }
  const box = placed ? boxOf(placed) : itemBox(item, theme);
  const { definition } = item;
  // Lines (`connector`, `packet_stream`) draw themselves along their path on enter.
  const drawn = (node: ReactNode) =>
    definition.layoutRole === 'path' ? (
      node
    ) : (
      <DrawReveal
        draw={state.draw}
        dimmed={state.dimmed}
        shapes={definition.outline?.(item.props, box, theme)}
        box={box}
      >
        {node}
      </DrawReveal>
    );
  const state = containedState(
    elementState(item.events, frame, fps, item.focus),
    containerPresence,
  );
  // Dimmed, muted text keeps its contrast floor (`dimmedTheme`).
  const drawTheme = dimmedTheme(theme, state.dimmed);
  const path = placed?.path;
  if (placed?.children) {
    return drawn(
      <Component theme={drawTheme} props={item.props} box={box} state={state} path={path}>
        {item.children.map((child) => {
          const at = placed.children?.find((c) => c.key === child.key);
          if (!at) return null;
          const size = boxOf(at);
          return (
            <div
              key={child.key}
              style={{
                position: 'absolute',
                left: at.rect.x,
                top: at.rect.y,
                ...size,
                transform: `scale(${at.scale})`,
                transformOrigin: '0 0',
              }}
            >
              <WorldItemView
                theme={theme}
                item={child}
                frame={frame}
                fps={fps}
                containerPresence={state.presence}
                placed={at}
              />
            </div>
          );
        })}
      </Component>,
    );
  }
  const room = childRoom(theme, box, item.children.length);
  return drawn(
    <Component theme={drawTheme} props={item.props} box={box} state={state} path={path}>
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
    </Component>,
  );
}

/** An item's box when it stands alone (sheets): its preferred size. */
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
