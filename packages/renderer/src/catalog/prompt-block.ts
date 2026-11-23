import {
  closedListSection,
  renderLayoutModeCatalogue,
  renderStoryCatalogues,
  type LibraryAsset,
} from '@explainer-studio/shared';
import {
  buildCatalogue,
  type PatternCatalogueEntry,
  type PrimitiveCatalogueEntry,
} from './catalogue.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * The catalogue block agent prompts carry (P1C.4): the story catalogues (topic classes, devices,
 * layout modes, metaphor worlds), then every primitive and pattern as compact JSON, one per line,
 * in `buildCatalogue` order. Deterministic for the same registries, whatever their insertion
 * order, so it can sit in the cached static prefix. Assets are left out: the Generator gets a
 * per-beat asset list (P1C.7).
 */
export function catalogueBlock(registries: Registries = DEFAULT_REGISTRIES): string {
  const { primitives, patterns } = buildCatalogue(registries);
  return [
    renderStoryCatalogues(),
    closedListSection('PRIMITIVES', [PRIMITIVES_NOTE, ...primitives.map(jsonLine)]),
    closedListSection('PATTERNS', [PATTERNS_NOTE, ...patterns.map(jsonLine)]),
  ].join('\n\n');
}

/**
 * The Director's catalogue block (P1C.5): the story catalogues, then every primitive and pattern
 * as a summary (id, family, summary, when / when not; patterns also their layout mode, formats
 * and anchor names), without props or params schemas: the Director suggests ids, the Generator
 * fills them in with the full block. Same order and determinism as `catalogueBlock`.
 */
export function directorCatalogueBlock(registries: Registries = DEFAULT_REGISTRIES): string {
  const { primitives, patterns } = buildCatalogue(registries);
  return [
    renderStoryCatalogues(),
    closedListSection('PRIMITIVES', [
      DIRECTOR_PRIMITIVES_NOTE,
      ...primitives.map(primitiveSummary).map(jsonLine),
    ]),
    closedListSection('PATTERNS', [
      DIRECTOR_PATTERNS_NOTE,
      ...patterns.map(patternSummary).map(jsonLine),
    ]),
  ].join('\n\n');
}

/**
 * The Generator's catalogue block (P1C.7): the layout modes, every primitive as in
 * `catalogueBlock`, every pattern with its `params.at` reduced to a pointer at its `anchors` (the
 * anchor shape is stated once, in the section note: a word index), then the approved assets
 * (`registries.assets`) sorted by family, then id. No devices, topic classes or metaphor worlds:
 * the plan has chosen them. The same for every beat and run with the same registries, whatever
 * their insertion order, so it sits in the cached prefix; per-run lists (logo slots, the
 * allowed layout modes) go in the user message.
 */
export function generatorCatalogueBlock(registries: Registries = DEFAULT_REGISTRIES): string {
  const { primitives, patterns } = buildCatalogue(registries);
  return [
    renderLayoutModeCatalogue(),
    closedListSection('PRIMITIVES', [PRIMITIVES_NOTE, ...primitives.map(jsonLine)]),
    closedListSection('PATTERNS', [
      `${PATTERNS_NOTE} ${GENERATOR_ANCHOR_NOTE}`,
      ...patterns.map(withAnchorPointer).map(jsonLine),
    ]),
    closedListSection('ASSETS', [ASSETS_NOTE, ...assetLines(registries.assets.values())]),
  ].join('\n\n');
}

/** What every anchor is: stated once for the whole pattern list. */
export const GENERATOR_ANCHOR_NOTE =
  "Every anchor, in an event's `at` and in a pattern's `params.at`, is " +
  '{"type":"word","index":<n>}: the 0-based index of a word in this beat\'s numbered narration.';

/** `params.at` as a pointer at the entry's `anchors`, instead of one anchor schema per name. */
const AT_POINTER = {
  type: 'object',
  description:
    "One anchor per name in this pattern's `anchors` (the shape is in the note above); " +
    'optional ones may be left out.',
};

export function withAnchorPointer(entry: PatternCatalogueEntry): PatternCatalogueEntry {
  const properties = entry.params.properties;
  if (!isRecord(properties) || !('at' in properties)) return entry;
  return { ...entry, params: { ...entry.params, properties: { ...properties, at: AT_POINTER } } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ASSETS_NOTE =
  'Approved asset ids for every prop that takes one, one per line: id (family): name; tags.';

/** One line per asset, sorted by family, then id (code units, never the host locale). */
export function assetLines(assets: Iterable<LibraryAsset>): string[] {
  return [...assets]
    .sort((a, b) => byCodeUnits(a.family, b.family) || byCodeUnits(a.id, b.id))
    .map((a) => `- ${a.id} (${a.family}): ${a.name}; ${a.tags.join(', ')}`);
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const DIRECTOR_PRIMITIVES_NOTE =
  'One JSON object per primitive. Name one as a missing-primitive fallback; the Generator ' +
  'places primitives.';

const DIRECTOR_PATTERNS_NOTE =
  'One JSON object per pattern: suggest ids per beat (`suggestedPatternIds`). `anchors` are the ' +
  'narration moments it animates on; `formats` the video formats it reads well in.';

function primitiveSummary(entry: PrimitiveCatalogueEntry) {
  const { id, family, summary, whenToUse, whenNotToUse } = entry;
  return { id, family, summary, whenToUse, whenNotToUse };
}

function patternSummary(entry: PatternCatalogueEntry) {
  const { id, family, summary, whenToUse, whenNotToUse, layoutMode, formats, formatRule } = entry;
  return {
    id,
    family,
    summary,
    whenToUse,
    whenNotToUse,
    layoutMode,
    formats,
    ...(formatRule ? { formatRule } : {}),
    anchors: entry.anchors.map((a) => (a.optional ? `${a.name}?` : a.name)),
  };
}

const PRIMITIVES_NOTE =
  'One JSON object per primitive. `partActions`: actions an event may apply to named parts ' +
  '(`params.parts`, exactly one target).';

const PATTERNS_NOTE =
  'One JSON object per pattern. Events on an instance use its `actions`; events on one inner ' +
  'element (`<instance>/<id>`) use only `innerActions`. A beat without its own `layoutMode` uses ' +
  "its first pattern's.";

function jsonLine(entry: unknown): string {
  return JSON.stringify(entry);
}
