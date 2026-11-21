/**
 * Bare source labels: a footnote has to say who published what ("libfoo README", "Acme
 * engineering blog"), so a source line of a single word, or one that is only a source's site or
 * library name, says too little. Pure.
 */

/** What the checks know about a source: its title and its URL or file name. */
export interface SourceIdentity {
  readonly title: string | null;
  readonly origin: string;
}

const fold = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, ' ');

/** "engineering.acme.com" → itself, "acme.com" and "acme" (a leading "www." dropped). */
function siteNames(origin: string): string[] {
  // shared has no DOM or Node types, so the host is read without `URL`.
  const match = /^https?:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(origin.trim());
  if (!match) return [];
  const host = match[1]!.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.');
  const domain = labels.slice(-2).join('.');
  return [host, domain, labels.at(-2) ?? ''].filter(Boolean);
}

/**
 * The names a bare source line would be: each URL source's site names, and each source title
 * that is a single word (a README titled with its library's name).
 */
export function bareSourceNames(sources: readonly SourceIdentity[]): string[] {
  const names = sources.flatMap((s) => [
    ...siteNames(s.origin),
    ...(s.title && fold(s.title).split(' ').length === 1 ? [fold(s.title)] : []),
  ]);
  return [...new Set(names.map(fold))];
}

/** Whether a source line is bare: one word, or nothing but a known site or library name. */
export function isBareSourceLine(line: string, names: readonly string[] = []): boolean {
  const folded = fold(line);
  return folded.split(' ').length <= 1 || names.some((name) => fold(name) === folded);
}

/** The repair message for a bare source line. */
export function bareSourceMessage(where: string, line: string): string {
  return (
    `${where} source line "${line}" is a bare name: name the publisher and what it is, ` +
    `e.g. 'libfoo README'.`
  );
}
