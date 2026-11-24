import type { ExplanationLevel } from '../config/video.ts';
import type { VideoSpec } from '../spec/shape.ts';
import { toJsonPath, type SpecError } from '../spec/validate.ts';
import { readability } from '../text/readability.ts';

/**
 * Each beat's narration scored for reading ease (Flesch, `text/readability.ts`): below its
 * level's threshold it warns `readability_low` (advisory), and the Curator's review sees the
 * score. A weak signal: jargon in short words ("zone", "p99") scores well, so the review still
 * judges words above the level. Pure.
 */

/** Lowest reading ease per level (beginner: plain conversational English); none for experts. */
export const READABILITY_THRESHOLDS: Readonly<Record<ExplanationLevel, number | null>> = {
  beginner: 60,
  intermediate: 50,
  expert: null,
};

/** Long words a message names, at most. */
const LONG_WORDS_NAMED = 5;

export function readabilityProblems(spec: VideoSpec, level: ExplanationLevel): SpecError[] {
  const threshold = READABILITY_THRESHOLDS[level];
  if (threshold === null) return [];
  return (spec.script ?? []).flatMap((beat, i) => {
    const scored = readability(beat.narration);
    if (!scored || scored.score >= threshold) return [];
    const perSentence = Math.round((scored.words / scored.sentences) * 10) / 10;
    const long = scored.longWords.slice(0, LONG_WORDS_NAMED);
    const named = long.length > 0 ? ` Long words: ${long.join(', ')}.` : '';
    return [
      {
        path: toJsonPath(['script', i, 'narration']),
        code: 'readability_low',
        message:
          `Reading ease ${scored.score}, below ${threshold} for ${level} viewers ` +
          `(${perSentence} words a sentence).${named} Use shorter sentences and everyday words.`,
      },
    ];
  });
}
