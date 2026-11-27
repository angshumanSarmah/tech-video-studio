import type { AssetFamily } from '@explainer-studio/shared';

/**
 * The rules the Lucide manifest is built from (P1C.12; `lucide-manifest.ts`). Data only: which
 * icons are skipped and why, how a family is chosen, ids renamed to avoid a core seed id, and
 * hand-written aliases. Bump `LUCIDE_RULES_VERSION` when a rule changes; the manifest test then
 * asks for `assets:manifest` and the diff is reviewed.
 */

export const LUCIDE_RULES_VERSION = 2;

/** Why an icon is not imported. */
export const LUCIDE_SKIP_REASONS = [
  /** The core seed already has this glyph; its Lucide name becomes an alias of the seed id. */
  'seeded',
  /** A brand or trademark glyph (the house style has no logos). */
  'brand',
  /** An editor toolbar glyph: text formatting, alignment, spacing. */
  'text_formatting',
  /** It draws letters or digits (the house style allows only a generic symbol). */
  'letters_digits',
  /** Nothing an engineering explainer draws, and easy to misread (identity, astrology, drugs). */
  'off_topic',
  /** Another imported icon draws exactly the same shapes. */
  'duplicate_glyph',
  /** Its shapes do not fit the house format (tags, count). */
  'not_house_shapes',
] as const;
export type LucideSkipReason = (typeof LUCIDE_SKIP_REASONS)[number];

const BRAND = [
  'airplay',
  'bitcoin',
  'bluetooth',
  'bluetooth-connected',
  'bluetooth-off',
  'bluetooth-searching',
  'creative-commons',
  'scratch-blocks',
  'usb',
];

const TEXT_FORMATTING_PREFIXES = [
  'a-arrow-',
  'align-',
  'between-',
  'decimals-arrow-',
  'gap-',
  'heading-',
  'list-indent-',
  'margin',
  'pilcrow',
  'separator-',
  'stretch-',
  'stroke-line-',
  'text-align-',
];

const TEXT_FORMATTING = [
  'a-large-small',
  'baseline',
  'bold',
  'italic',
  'letter-spacing',
  'ligature',
  'line-height',
  'line-style',
  'remove-formatting',
  'spell-check',
  'spell-check-2',
  'strikethrough',
  'stroke-width',
  'subscript',
  'superscript',
  'text-initial',
  'text-wrap',
  'type',
  'type-outline',
  'underline',
  'whole-word',
];

const LETTERS_DIGITS_PREFIXES = ['letter-', 'circle-letter-', 'square-letter-', 'case-'];

const LETTERS_DIGITS = [
  'ad',
  'arrow-down-0-1',
  'arrow-down-1-0',
  'arrow-down-a-z',
  'arrow-down-z-a',
  'arrow-up-0-1',
  'arrow-up-1-0',
  'arrow-up-a-z',
  'arrow-up-z-a',
  'book-a',
  'book-type',
  'calendar-1',
  'clipboard-type',
  'closed-caption',
  'file-digit',
  'file-type',
  'file-type-corner',
  'hd',
  'languages',
  'letters',
  'numbers',
  'repeat-1',
];

const OFF_TOPIC_PREFIXES = ['zodiac-', 'cannabis', 'cigarette'];

const OFF_TOPIC = ['mars', 'mars-stroke', 'non-binary', 'transgender', 'venus', 'venus-and-mars'];

/** The rule-based skip reason for a Lucide name, if any (seeded and duplicates are found by glyph). */
export function ruleSkipReason(name: string): LucideSkipReason | undefined {
  const starts = (prefixes: readonly string[]) => prefixes.some((p) => name.startsWith(p));
  if (BRAND.includes(name)) return 'brand';
  if (TEXT_FORMATTING.includes(name) || starts(TEXT_FORMATTING_PREFIXES)) return 'text_formatting';
  if (LETTERS_DIGITS.includes(name) || starts(LETTERS_DIGITS_PREFIXES)) return 'letters_digits';
  if (OFF_TOPIC.includes(name) || starts(OFF_TOPIC_PREFIXES)) return 'off_topic';
  return undefined;
}

/**
 * Lucide names whose snake-case id is a core seed id drawn with another glyph: imported under
 * these ids instead (the seed keeps its id; fixtures and old specs use it).
 */
export const LUCIDE_ID_OVERRIDES: Readonly<Record<string, string>> = {
  book: 'book_closed',
  gamepad: 'gamepad_plain',
  pointer: 'hand_pointer',
  wand: 'wand_plain',
};

/**
 * Feather names in Lucide's LICENSE that no Lucide export carries any more (renamed without an
 * alias left): the current name -> the licence's name.
 */
export const FEATHER_RENAMED: Readonly<Record<string, string>> = {
  'circle-x': 'x-circle',
  'octagon-x': 'x-octagon',
  'square-x': 'x-square',
};

/**
 * Lucide names of seeded glyphs that must not become aliases: words that mean something else in
 * a tech topic (`store` is the shop glyph, but a data store in narration and ids).
 */
export const SEED_ALIAS_EXCLUDED: ReadonlySet<string> = new Set(['store']);

/** Hand-written aliases: true synonyms only (they are substituted without asking). */
export const HAND_ALIASES: Readonly<Record<string, string>> = {
  gpu_card: 'gpu',
  hard_disk: 'disk',
  software_package: 'module',
};

/** Names whose family the token rules would get wrong. */
const FAMILY_BY_NAME: Readonly<Record<string, AssetFamily>> = {
  'cable-car': 'transport',
  'cpu-ai': 'ai',
  'rotate-ccw-clock': 'time',
  'rotate-cw-clock': 'time',
  'rotate-cw-fading-clock': 'time',
  'circle-person-arms-spread': 'people',
  'person-standing': 'people',
  'chart-network': 'network',
  'hand-truck': 'transport',
  'tower-control': 'transport',
  'utility-pole': 'infra',
  'scan-face': 'security',
  'scan-text': 'ai',
};

/** `cloud-<weather>` is weather (object), not hosting. */
const WEATHER = new Set(['drizzle', 'fog', 'hail', 'lightning', 'moon', 'rain', 'snow', 'sun']);

/** Shape frames around a glyph: the family comes from what is inside (`square-terminal`). */
const FRAME_TOKENS = new Set([
  'badge',
  'circle',
  'diamond',
  'hexagon',
  'octagon',
  'pentagon',
  'square',
  'squircle',
  'triangle',
]);

const TOKENS: Readonly<Record<AssetFamily, readonly string[]>> = {
  infra: [
    'battery',
    'boxes',
    'circuit',
    'cloud',
    'container',
    'cpu',
    'database',
    'fan',
    'hard',
    'layer',
    'layers',
    'memory',
    'microchip',
    'pc',
    'plug',
    'power',
    'server',
    'solar',
  ],
  network: [
    'antenna',
    'cable',
    'cast',
    'earth',
    'ethernet',
    'globe',
    'hdmi',
    'link',
    'network',
    'nfc',
    'radar',
    'radio',
    'router',
    'rss',
    'satellite',
    'send',
    'share',
    'signal',
    'split',
    'unlink',
    'unplug',
    'usb',
    'waypoints',
    'wifi',
  ],
  data: [
    'activity',
    'archive',
    'axis',
    'barcode',
    'binary',
    'chart',
    'clipboard',
    'copy',
    'diagram',
    'file',
    'files',
    'folder',
    'folders',
    'funnel',
    'graph',
    'hash',
    'inbox',
    'list',
    'logs',
    'notebook',
    'notepad',
    'qr',
    'save',
    'scroll',
    'search',
    'sheet',
    'summary',
    'table',
    'tag',
    'tags',
    'trending',
  ],
  security: ['cctv', 'eye', 'fingerprint', 'id', 'key', 'lock', 'shield', 'vault'],
  people: [
    'accessibility',
    'baby',
    'biceps',
    'contact',
    'ear',
    'face',
    'footprints',
    'hand',
    'handshake',
    'mouth',
    'person',
    'speech',
    'user',
    'users',
  ],
  ai: ['bot', 'brain', 'robot', 'sparkle', 'sparkles', 'wand'],
  time: [
    'alarm',
    'calendar',
    'calendars',
    'clock',
    'history',
    'hourglass',
    'timeline',
    'timer',
    'watch',
  ],
  object: [],
  transport: [
    'ambulance',
    'anchor',
    'baggage',
    'bike',
    'bus',
    'car',
    'caravan',
    'compass',
    'drone',
    'ev',
    'forklift',
    'fuel',
    'helicopter',
    'hot',
    'kayak',
    'land',
    'locate',
    'luggage',
    'map',
    'milestone',
    'moped',
    'motorbike',
    'navigation',
    'parking',
    'plane',
    'road',
    'route',
    'sailboat',
    'scooter',
    'ship',
    'signpost',
    'tractor',
    'traffic',
    'trailer',
    'train',
    'tram',
    'truck',
    'van',
  ],
  ui: [
    'app',
    'bell',
    'bookmark',
    'bring',
    'captions',
    'cog',
    'columns',
    'combine',
    'crop',
    'delete',
    'dock',
    'download',
    'eject',
    'ellipsis',
    'expand',
    'external',
    'fast',
    'focus',
    'form',
    'forward',
    'frame',
    'fullscreen',
    'gallery',
    'grid',
    'grip',
    'group',
    'import',
    'inspection',
    'kanban',
    'lasso',
    'layout',
    'loader',
    'log',
    'mail',
    'mailbox',
    'mails',
    'maximize',
    'menu',
    'message',
    'messages',
    'mic',
    'minimize',
    'monitor',
    'mouse',
    'opacity',
    'option',
    'panel',
    'panels',
    'pause',
    'picture',
    'play',
    'pointer',
    'proportions',
    'ratio',
    'redo',
    'refresh',
    'replace',
    'reply',
    'rewind',
    'rows',
    'scaling',
    'scan',
    'screen',
    'settings',
    'shrink',
    'skip',
    'sliders',
    'spline',
    'step',
    'sticky',
    'swatch',
    'switch',
    'text',
    'toggle',
    'touchpad',
    'trash',
    'undo',
    'ungroup',
    'upload',
    'vector',
    'vibrate',
    'view',
    'voicemail',
    'volume',
    'zoom',
  ],
  symbol: [
    'ampersand',
    'ampersands',
    'angle',
    'arrow',
    'arrows',
    'asterisk',
    'asterism',
    'at',
    'award',
    'ban',
    'biohazard',
    'blend',
    'carets',
    'check',
    'chevron',
    'chevrons',
    'circle',
    'cone',
    'contrast',
    'copyleft',
    'corner',
    'cross',
    'crosshair',
    'crown',
    'cuboid',
    'cylinder',
    'diameter',
    'diamond',
    'divide',
    'dot',
    'ellipse',
    'equal',
    'exclamation',
    'flag',
    'flame',
    'ghost',
    'goal',
    'heart',
    'hexagon',
    'infinity',
    'info',
    'iteration',
    'lightbulb',
    'line',
    'medal',
    'merge',
    'minus',
    'move',
    'octagon',
    'omega',
    'pentagon',
    'percent',
    'phi',
    'pi',
    'plus',
    'pyramid',
    'question',
    'quote',
    'radiation',
    'radical',
    'radius',
    'rectangle',
    'recycle',
    'repeat',
    'rocket',
    'rotate',
    'scale',
    'section',
    'shapes',
    'shuffle',
    'sigma',
    'siren',
    'skull',
    'slash',
    'square',
    'squares',
    'squircle',
    'star',
    'tally',
    'tangent',
    'target',
    'thumbs',
    'torus',
    'triangle',
    'trophy',
    'x',
    'zap',
  ],
  dev: [
    'braces',
    'brackets',
    'bug',
    'code',
    'command',
    'component',
    'diff',
    'git',
    'lambda',
    'parentheses',
    'puzzle',
    'regex',
    'terminal',
    'variable',
    'webhook',
    'workflow',
  ],
};

const FAMILY_BY_TOKEN: ReadonlyMap<string, AssetFamily> = new Map(
  (Object.entries(TOKENS) as [AssetFamily, readonly string[]][]).flatMap(([family, tokens]) =>
    tokens.map((token) => [token, family] as const),
  ),
);

/**
 * The family of a Lucide icon from its name: an exact rule, else its first word's (Lucide names
 * read `<thing>-<modifier>`, so `house-wifi` is a house and `file-clock` a file); a first word
 * with no family is an `object`. A shape frame (`square-terminal`, `circle-check`) defers to the
 * word after it, and is a `symbol` when that word has no family (`circle-dashed`).
 */
export function lucideFamily(name: string): AssetFamily {
  const exact = FAMILY_BY_NAME[name];
  if (exact) return exact;
  const [first = '', second] = name.split('-');
  if (first === 'cloud' && name.split('-').some((w) => WEATHER.has(w))) return 'object';
  if (FRAME_TOKENS.has(first) && second !== undefined) {
    return FAMILY_BY_TOKEN.get(second) ?? 'symbol';
  }
  return FAMILY_BY_TOKEN.get(first) ?? 'object';
}
