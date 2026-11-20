import { writeFile } from 'node:fs/promises';
import { buildSubtitleCues, type SubtitleCue } from '@explainer-studio/renderer/catalog';
import { DEFAULT_THEME_ID, getTheme } from '@explainer-studio/renderer/theme';
import { writeAtomically, type RenderTarget } from './target.ts';

/**
 * SubRip subtitles from the cues the video burns in (`buildSubtitleCues`, same spec, theme and
 * format), so the SRT and the picture can never disagree. Times are on the narration track,
 * which the final mux lays from 0 s.
 */

/** The cues `VideoFromSpec` draws for this target. */
export function targetSubtitleCues(target: RenderTarget): SubtitleCue[] {
  return buildSubtitleCues(target.spec, getTheme(target.props.themeId ?? DEFAULT_THEME_ID));
}

/** `HH:MM:SS,mmm`, rounded to the millisecond. */
export function srtTimestamp(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor(totalSec / 60) % 60)}:${pad(totalSec % 60)},${pad(ms, 3)}`;
}

/**
 * One numbered block per cue (1-based), `start --> end`, the cue's line, a blank line between
 * blocks. UTF-8 text with LF line endings; the cue text is a single line.
 */
export function formatSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue, i) =>
      [`${i + 1}`, `${srtTimestamp(cue.startSec)} --> ${srtTimestamp(cue.endSec)}`, cue.text].join(
        '\n',
      ),
    )
    .map((block) => `${block}\n`)
    .join('\n');
}

/** Writes the target's SRT atomically; returns the number of cues. */
export async function writeSubtitles(target: RenderTarget, path: string): Promise<number> {
  const cues = targetSubtitleCues(target);
  await writeAtomically(path, (partial) => writeFile(partial, formatSrt(cues), 'utf8'));
  return cues.length;
}
