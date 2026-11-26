/**
 * How much a source's extracted text actually says (pure; gate 1's `source_thin`). Run 1's third
 * source passed ingestion with 511 characters: a post whose content was a diagram, three one-line
 * bullets that pointed at it, and two affiliate links. Substantive text is what is left after
 * lines that are only links, link labels ("Book: https://…") and site boilerplate (subscribe,
 * upgrade, share, "you might like") are dropped. Under `THIN_SOURCE_CHARS` of it, or under
 * `MIN_SUBSTANTIVE_SHARE` of the text at any length, the source is thin.
 */

/** Substantive characters below which one source is thin (a warning at gate 1). */
export const THIN_SOURCE_CHARS = 1_500;

/** Below this share of substantive text, a source of any length is mostly furniture: thin. */
export const MIN_SUBSTANTIVE_SHARE = 0.5;

/** Why a source is thin, most telling first. */
export const SOURCE_THIN_REASONS = ['points_at_image', 'mostly_boilerplate', 'short'] as const;
export type SourceThinReason = (typeof SOURCE_THIN_REASONS)[number];

export interface SourceQuality {
  readonly chars: number;
  /** Characters left after link-only, link-label and boilerplate lines. */
  readonly substantiveChars: number;
  /** The text refers to a diagram, image or chart it does not contain. */
  readonly pointsAtImage: boolean;
  /** Empty when the source is not thin. */
  readonly thin: readonly SourceThinReason[];
}

const URL = /https?:\/\/\S+|www\.\S+/gi;
const HAS_URL = /https?:\/\/|www\./i;

/** Site furniture rather than content: a line that is mostly one of these is dropped. */
const BOILERPLATE = [
  /\bsubscribe\b/i,
  /\bsubscribers?\b/i,
  /\bupgrade\b/i,
  /\bsign (?:up|in)\b/i,
  /\blog ?in\b/i,
  /\bfree trial\b/i,
  /\bshare (?:this|the) (?:post|article)\b/i,
  /\byou (?:might|may) (?:also )?(?:like|enjoy)\b/i,
  /\bif you enjoyed\b/i,
  /\bour (?:books?|newsletter|course)\b/i,
  /\bnewsletter\b/i,
  /\ball rights reserved\b/i,
  /\bcookies?\b/i,
];

/** "as shown in the diagram below", "see the chart", "in the image above". */
const POINTS_AT_IMAGE =
  /\b(?:shown|see|seen|illustrated|pictured|depicted|in) (?:in )?(?:the |this )?(?:diagram|image|chart|figure|picture|illustration|graphic|infographic)s?\b|\b(?:diagram|image|chart|figure|illustration|infographic)s? (?:below|above)\b/i;

/** A line that says nothing of its own: links, a label before a link, or site boilerplate. */
function isFurniture(line: string): boolean {
  const withoutLinks = line.replace(URL, ' ').trim();
  if (withoutLinks.length === 0) return true;
  // "SDI-vol1: https://…": a short label in front of a link.
  if (HAS_URL.test(line) && withoutLinks.replace(/[:\-–—|]\s*$/, '').split(/\s+/).length <= 3) {
    return true;
  }
  return BOILERPLATE.some((re) => re.test(line)) && line.split(/\s+/).length <= 25;
}

export function sourceQuality(text: string): SourceQuality {
  const lines = text.split('\n').map((l) => l.trim());
  const substantiveChars = lines
    .filter((l) => l.length > 0 && !isFurniture(l))
    .reduce((sum, l) => sum + l.length, 0);
  const pointsAtImage = POINTS_AT_IMAGE.test(text);
  const short = substantiveChars < THIN_SOURCE_CHARS;
  const mostly = substantiveChars < text.length * MIN_SUBSTANTIVE_SHARE;
  const thin: SourceThinReason[] = [
    ...(short && pointsAtImage ? ['points_at_image' as const] : []),
    ...(mostly ? ['mostly_boilerplate' as const] : []),
  ];
  if (short && thin.length === 0) thin.push('short');
  return { chars: text.length, substantiveChars, pointsAtImage, thin };
}

const REASON_TEXT: Readonly<Record<SourceThinReason, string>> = {
  points_at_image: 'its text points at a diagram or image it does not contain',
  mostly_boilerplate: 'much of it is links or site boilerplate',
  short: 'it is short',
};

/** "only 367 characters of content: its text points at a diagram …; it is short". */
export function thinSourceMessage(origin: string, quality: SourceQuality): string {
  const why = quality.thin.map((r) => REASON_TEXT[r]).join('; ');
  const fix = quality.pointsAtImage
    ? 'paste its text, or describe the diagram, as a source instead'
    : 'paste or upload a fuller source';
  return (
    `${origin} gave only ${quality.substantiveChars.toLocaleString('en-US')} characters of ` +
    `content (${quality.chars.toLocaleString('en-US')} extracted): ${why}. To use what it says, ` +
    `${fix}.`
  );
}
