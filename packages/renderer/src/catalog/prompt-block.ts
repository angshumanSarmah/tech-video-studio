import { closedListSection, renderStoryCatalogues } from '@explainer-studio/shared';
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
