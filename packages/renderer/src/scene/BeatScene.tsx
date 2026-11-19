import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo, type ReactNode } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { rectCss } from '../layers/rect-css.ts';
import type { Transform } from '../layout/fit.ts';
import { inflate, union } from '../layout/rect.ts';
import { specLayout } from '../layout/spec-layout.ts';
import { boxOf, type BoardLayout, type Guide, type PlacedItem } from '../layout/types.ts';
import { dimOpacity } from '../events/presets.ts';
import { activeView, type ActiveTransition, type TransitionView } from '../events/transitions.ts';
import { cameraAt } from '../layout/camera-track.ts';
import { elementState } from '../primitives/element-state.ts';
import { textCss, type Rect, type Theme } from '../theme/index.ts';
import { beatWorld, type WorldItem } from './beat-world.ts';
import { overlayLevel, splitLayers } from './scene-layers.ts';
import { footnoteOpacity, footnoteText } from './source-footnote.ts';
import { WorldItemView } from './WorldItemView.tsx';

/**
 * One beat's board, placed by the layout engine (`specLayout`: one placement per
 * `continuesPrevious` chain, computed once per spec). Board items are drawn back to front at their
 * placed rects under the chain's camera at this frame (`cameraAt`: a uniform zoom and pan of the
 * board layer, clipped to the board frame, easing between beats and focus changes); overlays are drawn at their own rects above it, with their contained children
 * where the nested layout put them (while one shows, the board dims through its elements' focus
 * track); the source footnote sits where the layout reserved it. During a beat transition the
 * whole scene is drawn through its view (opacity, scale, slide), clipped to the board area.
 */

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  beatId: string;
  /** Global frame the beat's `<Sequence>` starts at. */
  beatFrom: number;
  /** Transitions this scene plays (in at its start, out under the next beat's start). */
  transitions?: readonly ActiveTransition[];
};

export function BeatScene({ theme, spec, timing, beatId, beatFrom, transitions = [] }: Props) {
  const frame = useCurrentFrame() + beatFrom;
  const { fps } = useVideoConfig();
  const beat = specLayout(spec, theme).beats.get(beatId);
  const layers = useMemo(() => {
    const placed = beat ? placedByKey(beat.chain.board) : new Map<string, PlacedItem>();
    const draw = { theme, placedOf: (key: string) => placed.get(key) };
    return splitLayers(beatWorld(spec, timing, beatId, fps, DEFAULT_REGISTRIES, draw));
  }, [spec, timing, beatId, fps, theme, beat]);
  if (!beat) return null;
  const { board, footnote } = beat.chain;
  const overlays = overlayLevel(
    layers.overlays.map((item) => elementState(item.events, frame, fps).presence),
  );
  const footnoteLine = footnoteText(spec, beatId);
  const beatStartSec = timing.beats.find((b) => b.beatId === beatId)?.startSec ?? 0;
  const clip = inflate(board.frame, theme.space.sm);
  return (
    <TransitionFrame
      theme={theme}
      clip={union([clip, ...(footnote ? [footnote] : [])]) ?? clip}
      view={activeView(transitions, frame)}
    >
      <Board
        theme={theme}
        clip={clip}
        camera={cameraAt(beat.chain.cameras, frame / fps)}
        guides={board.guides}
        guideOpacity={dimOpacity(overlays)}
        items={layers.board}
        placed={board.items}
        frame={frame}
        fps={fps}
      />
      {layers.overlays.map((item) => (
        <Placed
          key={item.key}
          theme={theme}
          item={item}
          placed={board.overlays.find((p) => p.key === item.key)}
          frame={frame}
          fps={fps}
        />
      ))}
      {footnote && footnoteLine ? (
        <SourceFootnote
          theme={theme}
          text={footnoteLine}
          rect={footnote}
          opacity={footnoteOpacity(frame / fps, beatStartSec)}
        />
      ) : null}
    </TransitionFrame>
  );
}

type TransitionFrameProps = {
  theme: Theme;
  clip: Rect;
  view: TransitionView | undefined;
  children: ReactNode;
};

/**
 * Draws the scene through a transition view, clipped to the board area (so a slide never runs
 * over the HUD or out of the card window); outside a transition, the scene as is.
 */
function TransitionFrame({ theme, clip, view, children }: TransitionFrameProps) {
  if (!view) return <>{children}</>;
  const originX = clip.x + clip.width / 2;
  const originY = clip.y + clip.height / 2;
  return (
    <div style={{ ...rectCss(clip), overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: -clip.x,
          top: -clip.y,
          width: theme.canvas.width,
          height: theme.canvas.height,
          opacity: view.opacity,
          transform: `translateX(${view.shift * clip.width}px) scale(${view.scale})`,
          transformOrigin: `${originX}px ${originY}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Every placed item of a board (board items, overlays and their children) by key. */
function placedByKey(board: BoardLayout): Map<string, PlacedItem> {
  const out = new Map<string, PlacedItem>();
  const add = (items: readonly PlacedItem[]) => {
    for (const item of items) {
      out.set(item.key, item);
      add(item.children ?? []);
    }
  };
  add(board.items);
  add(board.overlays);
  return out;
}

type BoardProps = {
  theme: Theme;
  clip: Rect;
  camera: Transform;
  guides: readonly Guide[];
  guideOpacity: number;
  items: readonly WorldItem[];
  placed: readonly PlacedItem[];
  frame: number;
  fps: number;
};

/** The board layer: canvas-space items under the camera, clipped to the (padded) board frame. */
function Board(props: BoardProps) {
  const { theme, clip, camera, guides, guideOpacity, items, placed, frame, fps } = props;
  const byKey = new Map(items.map((item) => [item.key, item]));
  return (
    <div style={{ ...rectCss(clip), overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: -clip.x,
          top: -clip.y,
          width: theme.canvas.width,
          height: theme.canvas.height,
          transform: `translate(${camera.dx}px, ${camera.dy}px) scale(${camera.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <Guides theme={theme} guides={guides} opacity={guideOpacity} />
        {placed.map((p) => {
          const item = byKey.get(p.key);
          return item ? (
            <Placed key={p.key} theme={theme} item={item} placed={p} frame={frame} fps={fps} />
          ) : null;
        })}
      </div>
    </div>
  );
}

type PlacedProps = {
  theme: Theme;
  item: WorldItem;
  placed: PlacedItem | undefined;
  frame: number;
  fps: number;
};

/** One item at its placed rect: drawn in its own box px and scaled to the rect. */
function Placed({ theme, item, placed, frame, fps }: PlacedProps) {
  if (!placed) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: placed.rect.x,
        top: placed.rect.y,
        ...boxOf(placed),
        transform: `scale(${placed.scale})`,
        transformOrigin: '0 0',
      }}
    >
      <WorldItemView theme={theme} item={item} frame={frame} fps={fps} placed={placed} />
    </div>
  );
}

/** Faint lines the mode draws (swimlane lifelines, the versus divider). */
type GuidesProps = { theme: Theme; guides: readonly Guide[]; opacity: number };

function Guides({ theme, guides, opacity }: GuidesProps) {
  if (guides.length === 0) return null;
  const stroke = theme.stroke.thin;
  return (
    <svg
      width={theme.canvas.width}
      height={theme.canvas.height}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity }}
    >
      {guides.map((g, i) => (
        <line
          key={i}
          x1={g.from.x}
          y1={g.from.y}
          x2={g.to.x}
          y2={g.to.y}
          stroke={theme.colours.ink.faint}
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 4} ${stroke * 4}`}
        />
      ))}
    </svg>
  );
}

type FootnoteProps = { theme: Theme; text: string; rect: Rect; opacity: number };

function SourceFootnote({ theme, text, rect, opacity }: FootnoteProps) {
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        ...rectCss(rect),
        ...textCss(theme, 'footnote'),
        color: theme.colours.ink.faint,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity,
      }}
    >
      {text}
    </div>
  );
}
