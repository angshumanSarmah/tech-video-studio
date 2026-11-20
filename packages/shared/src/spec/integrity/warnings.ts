import { TOPIC_CLASS_CATALOGUE } from '../../catalogues/topic-classes.ts';
import { LAYOUT_MODE_IDS } from '../../catalogues/layout-modes.ts';
import type { VideoSpec } from '../shape.ts';
import type { SpecIssue } from './issue.ts';

/** Allowed drift between the beats' target seconds and the video's target length. */
export const TARGET_LENGTH_TOLERANCE = 0.1;

/** Problems that do not make a spec invalid. Agents repair them; user edits save with them. */
export function findSpecWarnings(spec: VideoSpec): SpecIssue[] {
  return [
    ...checkTargetLength(spec),
    ...checkContinuingTransitions(spec),
    ...checkAllowedLayoutModes(spec),
  ];
}

/**
 * Explicit layout modes (story beats and scenes) outside the topic class's `allowedLayoutModes`.
 * Unknown modes are errors elsewhere; a beat that takes its pattern's mode is not checked here.
 */
function checkAllowedLayoutModes({ meta, story, scenes }: VideoSpec): SpecIssue[] {
  const allowed: readonly string[] =
    TOPIC_CLASS_CATALOGUE.entries.find((e) => e.id === meta.topicClass)?.allowedLayoutModes ?? [];
  const known: readonly string[] = LAYOUT_MODE_IDS;
  const check = (path: SpecIssue['path'], mode: string | undefined): SpecIssue[] =>
    mode === undefined || !known.includes(mode) || allowed.includes(mode)
      ? []
      : [
          {
            path,
            code: 'layout_mode_not_allowed',
            message:
              `Layout mode "${mode}" is not among the ${meta.topicClass} topic class's modes: ` +
              `${allowed.join(', ')}.`,
          },
        ];
  return [
    ...story.beats.flatMap((beat, i) =>
      check(['story', 'beats', i, 'layoutMode'], beat.layoutMode),
    ),
    ...(scenes ?? []).flatMap((scene, i) => check(['scenes', i, 'layoutMode'], scene.layoutMode)),
  ];
}

/** A continuing beat keeps its board (the camera eases instead), so its `transitionIn` is ignored. */
function checkContinuingTransitions({ scenes }: VideoSpec): SpecIssue[] {
  return (scenes ?? []).flatMap((scene, i) =>
    scene.continuesPrevious && scene.transitionIn !== 'cut'
      ? [
          {
            path: ['scenes', i, 'transitionIn'],
            code: 'transition_on_continuing_beat',
            message:
              `Beat "${scene.beatId}" continues the previous board, so its transition ` +
              `"${scene.transitionIn}" is ignored (the camera eases instead). Use "cut", or ` +
              'start a new board.',
          },
        ]
      : [],
  );
}

function checkTargetLength({ meta, story }: VideoSpec): SpecIssue[] {
  const target = meta.targetLengthSec;
  const total = story.beats.reduce((sum, beat) => sum + beat.targetSec, 0);
  if (Math.abs(total - target) <= target * TARGET_LENGTH_TOLERANCE) return [];
  return [
    {
      path: ['story', 'beats'],
      code: 'target_length_mismatch',
      message: `Beat targetSec values sum to ${total} s; expected ${target} s ±${TARGET_LENGTH_TOLERANCE * 100}%.`,
    },
  ];
}
