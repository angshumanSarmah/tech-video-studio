import { toJsonPath, type RenderableVideoSpec, type SpecError } from '@explainer-studio/shared';
import type { Theme } from '../theme/index.ts';
import { buildSubtitleCues, subtitleRoom } from './cues.ts';

/**
 * A narration word wider than one line of the subtitle band. Subtitles never cut text: such a
 * word gets a cue of its own, drawn scaled down to fit, and this warning asks for a shorter word.
 */
export const SUBTITLE_WORD_TOO_WIDE = 'subtitle_word_too_wide';

/**
 * Subtitle warnings for the spec's format in `theme`, from the same cues the video draws and the
 * SRT holds. One warning per beat and word, at that beat's narration. Pure.
 */
export function subtitleWarnings(spec: RenderableVideoSpec, theme: Theme): SpecError[] {
  const room = subtitleRoom(theme, spec);
  const seen = new Set<string>();
  return buildSubtitleCues(spec, theme).flatMap((cue) => {
    const word = cue.words[0];
    if (cue.scale >= 1 || !word) return [];
    const index = spec.script.findIndex((s) => s.beatId === cue.beatId);
    const key = `${cue.beatId}\u0000${cue.text}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        path: toJsonPath(['script', index, 'narration']),
        code: SUBTITLE_WORD_TOO_WIDE,
        message:
          `Beat "${cue.beatId}": "${cue.text}" is ${Math.round(cue.width)} px wide, but a ` +
          `subtitle line has ${Math.round(room)} px; it is shrunk to fit. Use a shorter word.`,
      },
    ];
  });
}
