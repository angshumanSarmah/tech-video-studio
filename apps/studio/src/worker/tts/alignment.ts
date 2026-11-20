import type { TimedWord } from '@explainer-studio/shared';
import type { SpeechPlan } from './pronunciations.ts';

/** A token as the Kokoro server reports it (misaki G2P token + duration-predictor times). */
export interface EngineToken {
  readonly text: string;
  readonly phonemes: string;
  readonly startSec: number | null;
  readonly endSec: number | null;
}

interface PlacedToken {
  readonly start: number;
  readonly end: number;
  readonly startSec: number;
  readonly endSec: number;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Speech, not a pause: has word characters, phonemes and a non-empty time span. */
function spokenSpan(token: EngineToken): { startSec: number; endSec: number } | undefined {
  const { startSec, endSec } = token;
  if (startSec === null || endSec === null || endSec <= startSec) return undefined;
  if (!WORD_CHAR.test(token.text) || !token.phonemes.trim()) return undefined;
  return { startSec, endSec };
}

/**
 * Finds each token in the spoken text, in order. A token is placed only where nothing but
 * whitespace and punctuation lies between it and the previous one; a token that cannot be placed
 * is skipped (its word then ends up unspoken, which fails loudly instead of misaligning).
 */
export function placeTokens(spokenText: string, tokens: readonly EngineToken[]): PlacedToken[] {
  const placed: PlacedToken[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (!token.text) continue;
    const at = spokenText.indexOf(token.text, cursor);
    if (at < 0 || WORD_CHAR.test(spokenText.slice(cursor, at))) continue;
    cursor = at + token.text.length;
    const span = spokenSpan(token);
    if (span) placed.push({ start: at, end: cursor, ...span });
  }
  return placed;
}

export type AlignmentResult =
  | { readonly ok: true; readonly words: TimedWord[] }
  | { readonly ok: false; readonly problems: string[] };

/**
 * Maps engine tokens back onto the narration words of `plan`: each word spans from its first to
 * its last overlapping spoken token. A word with no spoken token is an error, never interpolated:
 * a silently dropped word must fail the synthesis.
 */
export function alignWords(plan: SpeechPlan, tokens: readonly EngineToken[]): AlignmentResult {
  const placed = placeTokens(plan.spokenText, tokens);
  const words: TimedWord[] = [];
  const problems: string[] = [];
  for (const [index, word] of plan.words.entries()) {
    const hits = placed.filter((token) => token.start < word.end && token.end > word.start);
    const first = hits[0];
    const last = hits.at(-1);
    if (!first || !last) {
      const spoken = plan.spokenText.slice(word.start, word.end);
      problems.push(`word not spoken: ${word.text} (word ${index}, read as "${spoken}")`);
      continue;
    }
    words.push({ text: word.text, startSec: first.startSec, endSec: last.endSec });
  }
  return problems.length ? { ok: false, problems } : { ok: true, words };
}
