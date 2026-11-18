import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { safeAreas, semanticTint, textCss, type Theme } from '../theme/index.ts';
import { resolveEventFrames } from '../timing/frames.ts';
import { devTargets, devTargetState, type DevTarget } from './dev-state.ts';

/**
 * TEMPORARY scene layer (P1A.3). Shows a beat's intent and its elements as chips that appear,
 * hide and flash on their anchored frames, so timing can be checked in Studio before primitives
 * exist. P1A.5 replaces it with registry-driven primitives and deletes it; `dev-layers.test.ts`
 * fails once the registry exists and a composition still uses it. Never a fallback scene.
 */

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  beatId: string;
  /** Global frame the beat's `<Sequence>` starts at. */
  beatFrom: number;
};

export function DevBeatPreview({ theme, spec, timing, beatId, beatFrom }: Props) {
  const frame = useCurrentFrame() + beatFrom;
  const { fps } = useVideoConfig();
  const beat = useMemo(() => beatParts(spec, timing, beatId, fps), [spec, timing, beatId, fps]);
  const { stage } = useMemo(() => safeAreas(theme), [theme]);
  if (!beat) return null;
  return (
    <div
      style={{
        ...rectCss(stage),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: theme.space.lg,
      }}
    >
      <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.faint }}>
        dev preview · {beatId} · {beat.chapter}
      </div>
      <div style={{ ...textCss(theme, 'title'), color: theme.colours.ink.primary }}>
        {beat.intent}
      </div>
      {beat.headline ? (
        <div style={{ ...textCss(theme, 'body'), color: theme.colours.ink.muted }}>
          {beat.headline}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space.md }}>
        {beat.targets.map((target) => (
          <Chip
            key={target.id}
            theme={theme}
            target={target}
            state={devTargetState(target.id, beat.events, frame, Math.round(fps / 2))}
          />
        ))}
      </div>
    </div>
  );
}

function beatParts(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  beatId: string,
  fps: number,
) {
  const scene = spec.scenes.find((s) => s.beatId === beatId);
  const script = spec.script.find((s) => s.beatId === beatId);
  const story = spec.story.beats.find((b) => b.id === beatId);
  const beatTiming = timing.beats.find((b) => b.beatId === beatId);
  if (!scene || !script || !story || !beatTiming) return undefined;
  return {
    intent: story.intent,
    chapter: spec.story.chapters.find((c) => c.id === story.chapterId)?.title ?? story.chapterId,
    headline: script.headline?.text,
    targets: devTargets(scene),
    events: resolveEventFrames(scene, beatTiming, script.narration, fps),
  };
}

type ChipProps = { theme: Theme; target: DevTarget; state: ReturnType<typeof devTargetState> };

function Chip({ theme, target, state }: ChipProps) {
  const tint = semanticTint(theme, state.lastAction === 'reject' ? 'problem' : 'focus');
  return (
    <div
      style={{
        opacity: state.visible ? 1 : 0.15,
        padding: `${theme.space.sm}px ${theme.space.md}px`,
        borderRadius: theme.radius.md,
        border: `${theme.stroke.regular}px solid ${tint.border}`,
        backgroundColor: tint.soft,
        boxShadow: state.flash > 0 ? tint.glowShadow : 'none',
        transform: `scale(${1 + 0.08 * state.flash})`,
      }}
    >
      <div style={{ ...textCss(theme, 'tag'), color: theme.colours.ink.primary }}>{target.id}</div>
      <div style={{ ...textCss(theme, 'footnote'), color: theme.colours.ink.muted }}>
        {target.label}
        {state.lastAction ? ` · ${state.lastAction}` : ''}
      </div>
    </div>
  );
}
