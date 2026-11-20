import { closedListSection, renderStoryCatalogues } from '@explainer-studio/shared';
import { buildCatalogue } from './catalogue.ts';
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
