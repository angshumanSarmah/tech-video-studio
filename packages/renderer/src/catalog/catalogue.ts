import { ASSET_FAMILIES, type AssetFamily } from '@explainer-studio/shared';
import { z } from 'zod';
import { LAYOUT_MODE_DEFINITIONS } from '../layout/modes.ts';
import { INNER_TARGET_ACTIONS, type AnyPatternDefinition } from '../patterns/types.ts';
import { PRIMITIVE_FAMILIES, type AnyPrimitiveDefinition } from '../primitives/types.ts';
import { getTheme, type Theme } from '../theme/index.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Catalogues built from the registries: compact JSON for prompts and markdown for people. The
 * JSON holds only what an LLM needs (no size hints: the LLM never sees sizes). Both are written to
 * `docs/` by `gen:catalogue`; prompts build theirs at runtime with `buildCatalogue()`.
 */

type JsonSchema = Record<string, unknown>;

export type PrimitiveCatalogueEntry = {
  id: string;
  family: string;
  summary: string;
  whenToUse: string;
  whenNotToUse: string;
  actions: string[];
  /** Actions an event may use on named parts (`params.parts`); absent when it has no parts. */
  partActions?: string[];
  props: JsonSchema;
  example: { id: string; primitive: string; props: unknown };
};

export type PatternCatalogueEntry = {
  id: string;
  family: string;
  summary: string;
  whenToUse: string;
  whenNotToUse: string;
  actions: string[];
  anchors: { name: string; description: string; optional?: boolean }[];
  /** The beat's layout mode unless the scene sets one. */
  layoutMode: string;
  /** Video formats (`meta.format`) it reads well in. */
  formats: string[];
  /** Narrower formats for some params, e.g. full only with more than 2 workers. */
  formatRule?: { when: string; formats: string[] };
  /** Elements spec events may target as `<instance>/<id>`, with `innerActions` only. */
  targets: { id: string; description: string }[];
  innerActions: string[];
  params: JsonSchema;
  example: { id: string; pattern: string; params: unknown };
};

export type LayoutModeCatalogueEntry = { id: string; zones: string[]; description: string };

export type AssetCatalogueGroup = {
  family: AssetFamily;
  assets: { id: string; name: string; tags: string[] }[];
};

export type Catalogue = {
  primitives: PrimitiveCatalogueEntry[];
  patterns: PatternCatalogueEntry[];
  layoutModes: LayoutModeCatalogueEntry[];
  /**
   * Approved asset ids by family, from `registries.assets` (the seed library here; P1C.4 builds
   * the Generator's list from the DB at run time).
   */
  assets: AssetCatalogueGroup[];
};

/** Input-side JSON Schema (fields with defaults are optional), without the `$schema` header. */
export function inputJsonSchema(schema: z.ZodType): JsonSchema {
  const jsonSchema: JsonSchema = { ...z.toJSONSchema(schema, { io: 'input' }) };
  delete jsonSchema.$schema;
  return jsonSchema;
}

const byFamilyThenId = <T extends { family: string; id: string }>(a: T, b: T) =>
  PRIMITIVE_FAMILIES.indexOf(a.family as never) - PRIMITIVE_FAMILIES.indexOf(b.family as never) ||
  a.id.localeCompare(b.id);

export function buildCatalogue(registries: Registries = DEFAULT_REGISTRIES): Catalogue {
  return {
    primitives: [...registries.primitives.values()].map(primitiveEntry).sort(byFamilyThenId),
    patterns: [...registries.patterns.values()].map(patternEntry).sort(byFamilyThenId),
    layoutModes: LAYOUT_MODE_DEFINITIONS.map((m) => ({
      id: m.id,
      zones: [...m.zones],
      description: m.description,
    })),
    assets: assetGroups(registries),
  };
}

/** Families in `ASSET_FAMILIES` order (empty ones left out), ids sorted within each. */
function assetGroups({ assets }: Registries): AssetCatalogueGroup[] {
  const all = [...assets.values()];
  return ASSET_FAMILIES.map((family) => ({
    family,
    assets: all
      .filter((a) => a.family === family)
      .map((a) => ({ id: a.id, name: a.name, tags: [...a.tags] }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })).filter((group) => group.assets.length > 0);
}

function primitiveEntry(d: AnyPrimitiveDefinition): PrimitiveCatalogueEntry {
  return {
    id: d.id,
    family: d.family,
    ...d.description,
    actions: [...d.actions],
    ...(d.parts ? { partActions: [...d.parts.actions] } : {}),
    props: inputJsonSchema(d.propsSchema),
    example: { id: `<example-${d.id}-id>`, primitive: d.id, props: d.example.props },
  };
}

function patternEntry(d: AnyPatternDefinition): PatternCatalogueEntry {
  return {
    id: d.id,
    family: d.family,
    ...d.description,
    actions: [...d.actions],
    anchors: d.anchors.map((a) => ({ ...a })),
    layoutMode: d.layoutMode,
    formats: [...d.formats],
    ...(d.formatRule
      ? { formatRule: { when: d.formatRule.when, formats: [...d.formatRule.formats] } }
      : {}),
    targets: d.targets.map((t) => ({ ...t })),
    innerActions: [...INNER_TARGET_ACTIONS],
    params: inputJsonSchema(d.paramsSchema),
    example: { id: `<example-${d.id}-id>`, pattern: d.id, params: d.example.params },
  };
}

export function catalogueJson(registries: Registries = DEFAULT_REGISTRIES): string {
  return `${JSON.stringify(buildCatalogue(registries), null, 2)}\n`;
}

const GENERATED_NOTE =
  '<!-- Generated by `pnpm --filter @explainer-studio/renderer gen:catalogue`. Do not edit. -->';

export function catalogueMarkdown(
  registries: Registries = DEFAULT_REGISTRIES,
  theme: Theme = getTheme(),
): string {
  const { primitives, patterns, layoutModes, assets } = buildCatalogue(registries);
  const lines = [
    GENERATED_NOTE,
    '',
    '# Primitive and pattern catalogue',
    '',
    'Everything the Generator may put in a beat scene. Ids are exhaustive: there are no others.',
    '',
    'An event acts on its whole target. On primitives with **part actions**, an event with ' +
      '`params.parts` (a list of part ids) and exactly one target acts on those parts only.',
    '',
    'Fail → recover: a `reject` holds (red, crossed out) until a later `recover` on the same ' +
      'element or part ends it, with a short settle back to its own colour. Only `recover` ends ' +
      'a reject (`highlight`, `enter` and `pulse` do not). Every primitive and part that supports ' +
      '`reject` supports `recover`.',
    '',
    'Lock → release: a `lock` holds (padlock) until a later `release` on the same element or ' +
      'part fades it out. Only `release` ends a lock. Every primitive and part that supports ' +
      '`lock` supports `release`.',
    '',
    '## Timing, focus and transitions',
    '',
    '- Every event plays over its action’s preset duration and easing; never set times or ' +
      'durations.',
    '- A `highlight` starts about 0.2 s before its word and clears by the end of its beat or the ' +
      'next focus change. `params.hold: true` keeps it on (until a later `dim`, `exit` or ' +
      '`reject`).',
    '- An event on several targets, a pattern instance or several parts starts them slightly ' +
      'apart (`enter`, `exit`, `highlight`, `dim`, `pulse`). `params.stagger: "scan"` makes any ' +
      'event a deliberate one-by-one sweep: about 0.15 s apart (parts in the element’s own ' +
      'order), at most 2 s and never past the beat’s next event.',
    '- Focus: a scene’s `focus` ids show at full opacity and everything else dims (an empty ' +
      '`focus` dims nothing); the camera frames them. A `focus` event, valid on any element or ' +
      'pattern instance in scope, moves the focus to its targets from its word. While an overlay ' +
      'shows, focus moves to it and the board dims.',
    '- `transitionIn` (`cut`, `fade`, `slide`, `zoom-in`, `zoom-out`) applies to a beat that ' +
      'starts a new board; a `continuesPrevious` beat keeps its board, so leave it at `cut`. ' +
      'Semantic zoom: `transitionIn: "zoom-in"` with `zoomFrom` naming an element of the ' +
      'previous board pushes into it, then cuts to this board (a component, then its insides).',
    '',
    '## Primitives',
    '',
    ...primitives.flatMap((entry) => primitiveSection(entry, registries, theme)),
    '## Patterns',
    '',
    'A pattern is a reusable piece of choreography: it expands into primitives and timed events, ' +
      'anchored to the narration words in `params.at`. It stages its own entrances. Events on the ' +
      `instance may use only its **Actions**; events on one element inside it, targeted as ` +
      '`<instance>/<id>`, may use only ' +
      `${codeList(INNER_TARGET_ACTIONS)}. A beat without its own \`layoutMode\` uses its ` +
      "patterns' layout mode.",
    '',
    ...(patterns.length > 0
      ? patterns.flatMap(patternSection)
      : ['No patterns are registered yet.', '']),
    '## Layout modes',
    '',
    'Ids are exhaustive. Elements may name a zone of their beat’s layout mode.',
    '',
    '| Mode | Zones | Description |',
    '| --- | --- | --- |',
    ...layoutModes.map((m) => `| \`${m.id}\` | ${codeList(m.zones)} | ${m.description} |`),
    '',
    ...assetSection(assets),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

function primitiveSection(
  entry: PrimitiveCatalogueEntry,
  registries: Registries,
  theme: Theme,
): string[] {
  const definition = registries.primitives.get(entry.id);
  const hints = definition?.sizeHints(
    definition.propsSchema.parse(definition.example.props),
    theme,
  );
  return [
    `### ${entry.id}`,
    '',
    ...describedSection(entry),
    ...(entry.partActions
      ? [`**Part actions** (events with \`params.parts\`): ${codeList(entry.partActions)}`, '']
      : []),
    ...propsTable('Props', entry.props),
    ...(hints
      ? [
          `**Size hint** (example, ${theme.id}): ${hints.preferredWidth} × ${hints.preferredHeight} px ` +
            `(min ${hints.minWidth} × ${hints.minHeight}).`,
          '',
        ]
      : []),
    ...exampleBlock(entry.example),
  ];
}

function patternSection(entry: PatternCatalogueEntry): string[] {
  return [
    `### ${entry.id}`,
    '',
    ...describedSection(entry),
    `**Layout mode:** \`${entry.layoutMode}\``,
    '',
    `**Formats:** ${formatsLine(entry)}`,
    '',
    '**Narration anchors** (`params.at`):',
    '',
    ...entry.anchors.map(
      (a) => `- \`${a.name}\`${a.optional ? ' (optional)' : ''}: ${a.description}`,
    ),
    '',
    `**Inner elements** (target as \`<instance>/<id>\` with ${codeList(entry.innerActions)}):`,
    '',
    ...entry.targets.map((t) => `- \`${t.id}\`: ${t.description}`),
    '',
    ...propsTable('Params', entry.params),
    ...exampleBlock(entry.example),
  ];
}

/** "full, card (full only with more than 2 workers)". */
function formatsLine(entry: PatternCatalogueEntry): string {
  const base = codeList(entry.formats);
  const rule = entry.formatRule;
  return rule ? `${base} (${codeList(rule.formats)} only with ${rule.when})` : base;
}

function describedSection(entry: PrimitiveCatalogueEntry | PatternCatalogueEntry): string[] {
  return [
    `**Family:** ${entry.family} · **Actions:** ${codeList(entry.actions)}`,
    '',
    entry.summary,
    '',
    `**When to use:** ${entry.whenToUse}`,
    '',
    `**When not to:** ${entry.whenNotToUse}`,
    '',
  ];
}

function assetSection(groups: readonly AssetCatalogueGroup[]): string[] {
  return [
    '## Assets',
    '',
    'Asset ids for props that take one (`asset`, `icon`, `role`, `mover`), by family. Ids are ' +
      'exhaustive: there are no others. An unknown id is drawn as a placeholder and reported as ' +
      'a missing asset. Logo slots declared by the video (`logo_<name>`) may be used like asset ' +
      'ids; never invent one.',
    '',
    ...groups.flatMap((group) => [
      `### ${group.family}`,
      '',
      '| Id | Name | Tags |',
      '| --- | --- | --- |',
      ...group.assets.map((a) => `| \`${a.id}\` | ${a.name} | ${a.tags.join(', ')} |`),
      '',
    ]),
  ];
}

function codeList(items: readonly string[]): string {
  return items.map((a) => `\`${a}\``).join(', ');
}

function exampleBlock(example: unknown): string[] {
  return ['**Example:**', '', '```json', JSON.stringify(example, null, 2), '```', ''];
}

type PropSchema = {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema & { properties?: Record<string, unknown> };
};

function propsTable(title: string, schema: JsonSchema): string[] {
  const rows = propRows(schema, '');
  return [
    `**${title}:**`,
    '',
    '| Name | Type | Required | Notes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ];
}

/** One row per prop; the fields of an array of objects follow it as `name[].field` rows. */
function propRows(schema: JsonSchema, prefix: string): string[] {
  const properties = (schema.properties ?? {}) as Record<string, PropSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).flatMap(([name, prop]) => {
    const path = `${prefix}${name}`;
    const row = `| \`${path}\` | ${propType(prop)} | ${required.has(name) ? 'yes' : 'no'} | ${propNotes(prop)} |`;
    const item = prop.items;
    return item?.properties ? [row, ...propRows(item, `${path}[].`)] : [row];
  });
}

function propType(prop: PropSchema): string {
  if (prop.enum) return prop.enum.map((v) => `\`${String(v)}\``).join(' \\| ');
  return prop.type ?? 'any';
}

function propNotes(prop: PropSchema): string {
  const limits = [
    prop.minLength !== undefined ? `min length ${prop.minLength}` : '',
    prop.maxLength !== undefined ? `max length ${prop.maxLength}` : '',
    prop.minItems !== undefined ? `min items ${prop.minItems}` : '',
    prop.maxItems !== undefined ? `max items ${prop.maxItems}` : '',
    prop.minimum !== undefined ? `min ${prop.minimum}` : '',
    prop.maximum !== undefined ? `max ${prop.maximum}` : '',
    prop.default !== undefined ? `default \`${JSON.stringify(prop.default)}\`` : '',
  ].filter(Boolean);
  const notes = limits.length > 0 ? ` (${limits.join(', ')})` : '';
  return `${prop.description ?? ''}${notes}`.trim();
}
