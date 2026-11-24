import type { BeatScript } from '@explainer-studio/shared';
import { showEdgeSpaces } from '../primitives/common-props.ts';
import type { Leaf } from '../catalog/schema-leaves.ts';

/**
 * Edge spaces in screen text (P1C.7). Screen text is trimmed (`lineText`), except where the
 * space is the point: a text whose leading or trailing space also appears, exactly, in the
 * beat's script (a tag, or a quote in its narration, as the tokenizer's ' Paris'). There each
 * edge space is drawn as ␣ (`showEdgeSpaces`), so " Paris" and "Paris" stay distinct; an
 * accidental "Shared store " is trimmed silently. Applied to the raw props and params before
 * they are parsed (`beatWorld`), so layout, render and stills agree. Pure.
 */

/** Quoted text in narration: a quote with no letter or digit outside it (never "model's"). */
const QUOTES = [
  /(?<![\p{L}\p{N}])'([^'\n]*)'(?![\p{L}\p{N}])/gu,
  /"([^"\n]*)"/gu,
  /‘([^’\n]*)’/gu,
  /“([^”\n]*)”/gu,
];

const hasEdgeSpace = (text: string) => text !== text.trim() && text.trim() !== '';

/** The beat's script texts that start or end with a space: its tags and narration quotes. */
export function scriptEdgeTexts(script: BeatScript | undefined): ReadonlySet<string> {
  if (!script) return new Set();
  const quoted = QUOTES.flatMap((re) => [...script.narration.matchAll(re)].map((m) => m[1] ?? ''));
  return new Set([...script.tags, ...quoted].filter(hasEdgeSpace));
}

/**
 * `value` (raw props or params) with each text leaf that is one of `keep`, exactly, shown with
 * visible edge spaces; every other text is left for its schema to trim. Never mutates `value`.
 */
export function withScriptEdgeSpaces<T>(
  value: T,
  leaves: readonly Leaf[],
  keep: ReadonlySet<string>,
): T {
  const shown = leaves.filter((l) => l.kind === 'text' && keep.has(l.value));
  if (shown.length === 0) return value;
  const copy = structuredClone(value);
  for (const leaf of shown) setAt(copy, leaf.path, showEdgeSpaces(leaf.value as string));
  return copy;
}

function setAt(root: unknown, path: readonly (string | number)[], next: string): void {
  let at: unknown = root;
  for (const key of path.slice(0, -1)) {
    if (at === null || typeof at !== 'object') return;
    at = (at as Record<string | number, unknown>)[key];
  }
  const last = path.at(-1);
  if (last !== undefined && at !== null && typeof at === 'object') {
    (at as Record<string | number, unknown>)[last] = next;
  }
}
