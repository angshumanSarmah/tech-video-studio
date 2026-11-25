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

/** The heading of prompt section 5: what the rules are and what wins over them. */
export const STYLE_RULES_HEADING =
  "## STYLE RULES (your reviewer's standing preferences, oldest first. Follow them; where one " +
  'conflicts with a rule above, the rule above wins.)';

/**
 * The person's accepted rules (P1C.10), as prompt section 5: last in the system message, after
 * the cached catalogue, oldest first. Undefined when there are none.
 */
export function styleRulesSection(rules: readonly string[]): string | undefined {
  if (rules.length === 0) return undefined;
  return [STYLE_RULES_HEADING, ...rules.map((r) => `- ${r}`)].join('\n');
}

/**
 * A reviewer's note on the agent's whole answer (a gate's "regenerate with feedback", P1C.9),
 * appended as the user message's last section, so the static prefix still caches.
 */
export function withFeedback(message: string, feedback: string | undefined): string {
  const note = feedback?.trim();
  if (!note) return message;
  return `${message}\n\n## FEEDBACK (from the reviewer: answer again in full, and address this)\n${note}`;
}
