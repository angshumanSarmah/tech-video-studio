import type { ResearchNotes } from '@explainer-studio/shared';

/**
 * Run-input pieces every agent after the Researcher shares: the notes without chunk citations
 * and the style-rules prompt section.
 */

/** Chunk citations stay with gate 1: later agents cite fact and number ids, never chunks. */
export function notesWithoutChunks(notes: ResearchNotes): unknown {
  return JSON.parse(
    JSON.stringify(notes, (key, value: unknown) =>
      key === 'sourceChunkIds' || key === 'sourceChunkId' ? undefined : value,
    ),
  );
}

/** The person's accepted rules (P1C.10), as prompt section 5; undefined when there are none. */
export function styleRulesSection(rules: readonly string[]): string | undefined {
  if (rules.length === 0) return undefined;
  return ['## STYLE RULES (from your reviews; follow them)', ...rules.map((r) => `- ${r}`)].join(
    '\n',
  );
}
