import { SOURCE_TITLE_MAX } from '@explainer-studio/shared';

/**
 * Invisible characters that carry no meaning in prose and can smuggle text past a reader:
 * zero-width spaces and joiners, word joiner, BOM, soft hyphen, bidi controls and tag characters.
 */
const INVISIBLE = new RegExp(
  '[\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]|\\udb40[\\udc00-\\udc7f]',
  'g',
);
/** C0/C1 controls except tab and newline. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]', 'g');
/** No-break, fixed-width and ideographic spaces. */
const SPACES = new RegExp('[\\u00a0\\u2000-\\u200a\\u202f\\u205f\\u3000]', 'g');

/**
 * Extracted text in one canonical form, so the same content always hashes the same: NFC, `\n`
 * line ends, invisible and control characters removed, non-breaking and other spaces as plain
 * spaces, runs of spaces collapsed (leading indentation kept), no trailing spaces, at most one
 * blank line in a row, trimmed.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/\t/g, '  ')
    .replace(CONTROLS, '')
    .replace(SPACES, ' ')
    .split('\n')
    .map(normalizeLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLine(line: string): string {
  const indent = /^ */.exec(line)![0];
  return indent + line.slice(indent.length).replace(/ {2,}/g, ' ').trimEnd();
}

/** One line, at most `SOURCE_TITLE_MAX` characters (cut at a word, with an ellipsis). */
export function cleanTitle(title: string | null | undefined): string | null {
  const flat = normalizeText(title ?? '').replace(/\s+/g, ' ');
  if (flat === '') return null;
  if (flat.length <= SOURCE_TITLE_MAX) return flat;
  const cut = flat.slice(0, SOURCE_TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > SOURCE_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
