/** A command split for colouring: the verb (first word) and the rest, spacing kept. */
export type CommandParts = { verb: string; rest: string };

export function splitCommand(text: string): CommandParts {
  const match = /^(\S+)([\s\S]*)$/.exec(text);
  return match ? { verb: match[1] ?? '', rest: match[2] ?? '' } : { verb: '', rest: text };
}

/** The parts cut to the first `chars` characters of the command. */
export function visibleCommand(parts: CommandParts, chars: number): CommandParts {
  const verb = parts.verb.slice(0, Math.max(0, chars));
  const rest = parts.rest.slice(0, Math.max(0, chars - parts.verb.length));
  return { verb, rest };
}
