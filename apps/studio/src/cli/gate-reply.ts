import { FIX_FIELDS, type FixField, type GateId } from '@explainer-studio/shared';
import type { GateAction } from './args.ts';

/**
 * What the user typed at a gate prompt (P1C.9b), pure:
 * `a` approve · `r <feedback>` regenerate (G1 the Researcher, G2 the Director) · at G3 and G4
 * `r <beat>[:<fields>] <feedback>` one beat (fields default narration,board) or
 * `r scriptwriter|generator [<feedback>]` · `e [<notes>]` edit in $EDITOR · `x [<notes>]` reject
 * · `q` quit; `a [<notes>]` approves with a note. A decision with text may then propose a style
 * rule (P1C.10).
 */

export type GateReply =
  | { readonly kind: 'decide'; readonly decision: Exclude<GateAction, { action: 'edit' }> }
  | { readonly kind: 'edit'; readonly notes?: string }
  | { readonly kind: 'quit' }
  | { readonly kind: 'invalid'; readonly message: string };

export const GATE_PROMPT =
  '[a]pprove ["<note>"] / [r]egenerate <beat> "<feedback>" / [e]dit ["<note>"] / [x] reject ["<note>"] / [q]uit > ';

export function parseGateReply(line: string, gate: GateId): GateReply {
  const text = line.trim();
  const word = text.split(/\s+/, 1)[0] ?? '';
  const tail = text.slice(word.length).trim();
  switch (word.toLowerCase()) {
    case 'a':
    case 'approve': {
      const notes = unquote(tail);
      return { kind: 'decide', decision: { action: 'approve', ...(notes ? { notes } : {}) } };
    }
    case 'x':
    case 'reject': {
      const notes = unquote(tail);
      return { kind: 'decide', decision: { action: 'reject', ...(notes ? { notes } : {}) } };
    }
    case 'e':
    case 'edit': {
      const notes = unquote(tail);
      return { kind: 'edit', ...(notes ? { notes } : {}) };
    }
    case 'q':
    case 'quit':
      return { kind: 'quit' };
    case 'r':
    case 'regenerate':
      return regenerate(gate, tail);
    default:
      return { kind: 'invalid', message: `Type a, r, e, x or q (not "${text}").` };
  }
}

function regenerate(gate: GateId, tail: string): GateReply {
  if (gate === 'research' || gate === 'beat_sheet') {
    const target = gate === 'research' ? 'researcher' : 'director';
    return { kind: 'decide', decision: { action: 'regenerate', target, ...feedback(tail) } };
  }
  const first = tail.split(/\s+/, 1)[0] ?? '';
  const rest = unquote(tail.slice(first.length).trim());
  if (first === 'scriptwriter' || first === 'generator') {
    return { kind: 'decide', decision: { action: 'regenerate', target: first, ...feedback(rest) } };
  }
  const [beatId = '', fieldList] = first.split(':');
  const fields = (fieldList ?? 'narration,board').split(',').map((f) => f.trim());
  const known = (f: string): f is FixField =>
    f !== 'plan' && (FIX_FIELDS as readonly string[]).includes(f);
  if (!beatId || !fields.every(known) || !rest) {
    return {
      kind: 'invalid',
      message:
        'Regenerate a beat with: r <beat>[:<fields>] "<feedback>" (fields: ' +
        `${FIX_FIELDS.filter((f) => f !== 'plan').join(', ')}), or r scriptwriter|generator.`,
    };
  }
  return {
    kind: 'decide',
    decision: { action: 'regenerate', target: 'beat', beatId, fields, feedback: rest },
  };
}

function feedback(text: string): { feedback?: string } {
  const note = unquote(text);
  return note ? { feedback: note } : {};
}

function unquote(text: string): string {
  const match = /^(["'])([\s\S]*)\1$/.exec(text.trim());
  return (match ? match[2]! : text).trim();
}
