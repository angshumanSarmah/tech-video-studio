import { normalizeWord, type Pronunciations } from '@explainer-studio/shared';

/** One narration word (`narrationWords` order) and where its spoken form sits in the TTS text. */
export interface PlannedWord {
  /** The word as `narrationWords` returns it. */
  readonly text: string;
  /** Character range `[start, end)` of the word's spoken token in `spokenText`. */
  readonly start: number;
  readonly end: number;
}

export interface SpeechPlan {
  /** What the TTS engine reads: respelled, typographic quotes folded, tokens joined by spaces. */
  readonly spokenText: string;
  readonly words: readonly PlannedWord[];
}

const SPLIT_EDGES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;
const POSSESSIVE = /^(.+?)('s)$/u;
const FOLDED_CHARS: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

/** Folds typographic quotes so the G2P's tokens match our text byte for byte. */
function foldQuotes(text: string): string {
  return text.replace(/[‘’“”]/gu, (char) => FOLDED_CHARS[char] ?? char);
}

export type PronunciationLookup = (core: string) => string | undefined;

/**
 * A key with any capital letter matches only that exact case; an all-lowercase key matches any
 * case (see `PronunciationsSchema`).
 */
export function pronunciationLookup(dictionary: Pronunciations): PronunciationLookup {
  const exact = new Map(Object.entries(dictionary));
  const anyCase = new Map(Object.entries(dictionary).filter(([key]) => key === key.toLowerCase()));
  return (core) => exact.get(core) ?? anyCase.get(core.toLowerCase());
}

/** The spoken form of one whitespace token: its core respelled, edge punctuation kept. */
export function respellToken(token: string, lookup: PronunciationLookup): string {
  const [, lead = '', core = '', trail = ''] = SPLIT_EDGES.exec(token) ?? [];
  const direct = lookup(core);
  if (direct !== undefined) return `${lead}${direct}${trail}`;
  const possessive = POSSESSIVE.exec(core);
  const stem = possessive?.[1] && lookup(possessive[1]);
  if (stem) return `${lead}${stem}${possessive[2]}${trail}`;
  return token;
}

/**
 * Applies the dictionary token by token and records, for every narration word, the character
 * range of its spoken form, so word timings map back to the original words.
 */
export function planSpeech(text: string, dictionary: Pronunciations): SpeechPlan {
  const lookup = pronunciationLookup(dictionary);
  const words: PlannedWord[] = [];
  let spokenText = '';
  for (const token of text.split(/\s+/u).filter(Boolean)) {
    if (spokenText) spokenText += ' ';
    const spoken = respellToken(foldQuotes(token), lookup);
    // The word keeps the original spelling (anchors and subtitles count words this way).
    const word = normalizeWord(token);
    if (word)
      words.push({ text: word, start: spokenText.length, end: spokenText.length + spoken.length });
    spokenText += spoken;
  }
  return { spokenText, words };
}
