import {
  aliasProblems,
  lucideFileName,
  restyleIconNode,
  type IconNodeElement,
} from '@explainer-studio/renderer/catalog';
import {
  ASSET_FAMILIES,
  ASSET_MAX_SHAPES,
  LibraryAssetIdSchema,
  type AssetShape,
  type LibraryAsset,
} from '@explainer-studio/shared';
import { z } from 'zod';
import {
  FEATHER_RENAMED,
  HAND_ALIASES,
  LUCIDE_ID_OVERRIDES,
  LUCIDE_RULES_VERSION,
  LUCIDE_SKIP_REASONS,
  lucideFamily,
  ruleSkipReason,
} from './lucide-rules.ts';

/**
 * The full Lucide import (P1C.12): every icon of the pinned Lucide release, either imported (id,
 * name, family, tags, licence) or skipped with a reason. Built by `assets:manifest` from the
 * installed `lucide` (shapes) and `lucide-static` (tags) and committed as
 * `apps/studio/seed/assets/lucide.manifest.json`, so the import is reviewed as a diff. Seeding
 * reads it and takes each imported icon's shapes from the installed `lucide` package. Pure.
 */

const LucideNameSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const ImportEntrySchema = z.strictObject({
  lucide: LucideNameSchema,
  status: z.literal('import'),
  id: LibraryAssetIdSchema,
  name: z.string().min(1).max(40),
  family: z.enum(ASSET_FAMILIES),
  tags: z.array(z.string().min(1).max(32)).max(12),
  licence: z.enum(['ISC', 'ISC AND MIT']),
});

const SkipEntrySchema = z.strictObject({
  lucide: LucideNameSchema,
  status: z.literal('skip'),
  reason: z.enum(LUCIDE_SKIP_REASONS),
  /** `seeded`: the core seed id with this glyph; `duplicate_glyph`: the imported id. */
  sameAs: LibraryAssetIdSchema.optional(),
});

export const LucideManifestEntrySchema = z.discriminatedUnion('status', [
  ImportEntrySchema,
  SkipEntrySchema,
]);
export type LucideManifestEntry = z.infer<typeof LucideManifestEntrySchema>;
export type LucideImportEntry = z.infer<typeof ImportEntrySchema>;

export const LucideManifestSchema = z.strictObject({
  lucideVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  rulesVersion: z.number().int().min(1),
  /** Alias -> asset id: the Lucide names of seeded glyphs, then the hand-written synonyms. */
  aliases: z.record(LibraryAssetIdSchema, LibraryAssetIdSchema),
  entries: z.array(LucideManifestEntrySchema),
});
export type LucideManifest = z.infer<typeof LucideManifestSchema>;

/** Lucide's icon nodes by export name (`icons` from `lucide`; aliases share one node). */
export type LucideIcons = Readonly<Record<string, readonly IconNodeElement[]>>;

export interface LucideManifestInput {
  readonly version: string;
  readonly icons: LucideIcons;
  /** `lucide-static/tags.json`: canonical kebab names, each with its search words. */
  readonly tags: Readonly<Record<string, readonly string[]>>;
  /** The icon names Lucide's LICENSE lists as derived from Feather (old names included). */
  readonly featherNames: ReadonlySet<string>;
  /** The core seed set (`SEED_ASSETS`), which keeps its ids. */
  readonly core: readonly LibraryAsset[];
}

const MAX_TAGS = 12;
const MAX_TAG_CHARS = 32;

export function buildLucideManifest(input: LucideManifestInput): LucideManifest {
  const coreByGlyph = new Map(input.core.map((a) => [glyphKey(a.shapes), a.id]));
  const coreIds = new Set(input.core.map((a) => a.id));
  const aliasesOfNode = exportNamesByNode(input.icons);
  const importedByGlyph = new Map<string, string>();
  const aliases: Record<string, string> = {};
  const entries = Object.keys(input.tags)
    .sort(byCodeUnits)
    .map((name): LucideManifestEntry => {
      const node = input.icons[pascalName(name)];
      if (!node) throw new Error(`Lucide ${input.version} has no export for "${name}".`);
      const shapes = houseShapes(name, node);
      if (!shapes) return { lucide: name, status: 'skip', reason: 'not_house_shapes' };
      const glyph = glyphKey(shapes);
      const seeded = coreByGlyph.get(glyph);
      if (seeded !== undefined) {
        const alias = snakeId(name);
        if (alias !== seeded) aliases[alias] = seeded;
        return { lucide: name, status: 'skip', reason: 'seeded', sameAs: seeded };
      }
      const ruled = ruleSkipReason(name);
      if (ruled) return { lucide: name, status: 'skip', reason: ruled };
      const id = LUCIDE_ID_OVERRIDES[name] ?? snakeId(name);
      if (coreIds.has(id)) {
        throw new Error(`"${name}" would take the core seed id "${id}": add an id override.`);
      }
      const duplicate = importedByGlyph.get(glyph);
      if (duplicate !== undefined) {
        return { lucide: name, status: 'skip', reason: 'duplicate_glyph', sameAs: duplicate };
      }
      importedByGlyph.set(glyph, id);
      const exportNames = aliasesOfNode.get(node) ?? [];
      return {
        lucide: name,
        status: 'import',
        id,
        name: displayName(name),
        family: lucideFamily(name),
        tags: searchTags(input.tags[name] ?? [], id),
        licence: isFeatherDerived(name, exportNames, input.featherNames) ? 'ISC AND MIT' : 'ISC',
      };
    });
  const manifest: LucideManifest = {
    lucideVersion: input.version,
    rulesVersion: LUCIDE_RULES_VERSION,
    aliases: { ...aliases, ...HAND_ALIASES },
    entries,
  };
  const problems = manifestProblems(manifest, input.core);
  if (problems.length > 0) throw new Error(`Lucide manifest: ${problems.join(' ')}`);
  return manifest;
}

/** Duplicate ids and alias conflicts across the core seed and the imported icons. */
export function manifestProblems(
  manifest: LucideManifest,
  core: readonly LibraryAsset[],
): string[] {
  const imported = importEntries(manifest);
  const ids = [...core.map((a) => a.id), ...imported.map((e) => e.id)];
  const problems = ids
    .filter((id, i) => ids.indexOf(id) !== i)
    .map((id) => `Id "${id}" is used twice.`);
  const known = new Set(ids);
  for (const [alias, target] of Object.entries(manifest.aliases)) {
    if (!known.has(target)) problems.push(`Alias "${alias}" points at unknown id "${target}".`);
  }
  return [...problems, ...aliasProblems(withAliases(ids, manifest.aliases))];
}

export function importEntries(manifest: LucideManifest): LucideImportEntry[] {
  return manifest.entries.filter((e): e is LucideImportEntry => e.status === 'import');
}

/** Each id with the aliases that point at it (ids with none are listed bare). */
export function withAliases(
  ids: readonly string[],
  aliases: Readonly<Record<string, string>>,
): { id: string; aliases: string[] }[] {
  const byTarget = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(aliases).sort(([a], [b]) => byCodeUnits(a, b))) {
    byTarget.set(target, [...(byTarget.get(target) ?? []), alias]);
  }
  return ids.map((id) => ({ id, aliases: byTarget.get(id) ?? [] }));
}

/** `arrow-down-0-1` -> `ArrowDown01`: Lucide's export name for a canonical icon name. */
export function pascalName(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** `hard-drive` -> `hard_drive`. */
export function snakeId(name: string): string {
  return name.replaceAll('-', '_');
}

/** The restyled house shapes, or undefined when the icon does not fit the format. */
export function houseShapes(
  name: string,
  node: readonly IconNodeElement[],
): AssetShape[] | undefined {
  try {
    const shapes = restyleIconNode(name, node);
    return shapes.length > 0 && shapes.length <= ASSET_MAX_SHAPES ? shapes : undefined;
  } catch {
    return undefined;
  }
}

/** `database-zap` -> `Database zap`. */
function displayName(name: string): string {
  const words = name.split('-').join(' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40).trim();
}

/** Lucide's words, lowercased, without ones the id already says, at most 12. */
function searchTags(tags: readonly string[], id: string): string[] {
  const idWords = new Set(id.split('_'));
  const kept = tags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= MAX_TAG_CHARS && !idWords.has(t));
  return [...new Set(kept)].slice(0, MAX_TAGS);
}

/** Derived from Feather: its name, an old name Lucide renamed, or an alias is in the LICENSE. */
export function isFeatherDerived(
  name: string,
  exportNames: readonly string[],
  feather: ReadonlySet<string>,
): boolean {
  const renamed = FEATHER_RENAMED[name];
  return (
    feather.has(name) ||
    (renamed !== undefined && feather.has(renamed)) ||
    exportNames.some((n) => feather.has(lucideFileName(n)))
  );
}

function exportNamesByNode(icons: LucideIcons): Map<readonly IconNodeElement[], string[]> {
  const byNode = new Map<readonly IconNodeElement[], string[]>();
  for (const [exportName, node] of Object.entries(icons)) {
    byNode.set(node, [...(byNode.get(node) ?? []), exportName]);
  }
  return byNode;
}

function glyphKey(shapes: readonly AssetShape[]): string {
  return JSON.stringify(shapes);
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The Feather-derived names from Lucide's LICENSE text (the list after "Feather project:"). */
export function featherNamesFromLicence(licence: string): Set<string> {
  const listed = licence.split('Feather project:')[1]?.split('The MIT License')[0] ?? '';
  return new Set(
    listed
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0),
  );
}

/** The committed file: one entry and one alias per line, so a Lucide bump reviews as a diff. */
export function serializeLucideManifest(manifest: LucideManifest): string {
  const aliases = Object.entries(manifest.aliases).map(
    ([alias, id]) => `    ${JSON.stringify(alias)}: ${JSON.stringify(id)}`,
  );
  const entries = manifest.entries.map((e) => `    ${JSON.stringify(e)}`);
  return [
    '{',
    `  "lucideVersion": ${JSON.stringify(manifest.lucideVersion)},`,
    `  "rulesVersion": ${manifest.rulesVersion},`,
    '  "aliases": {',
    aliases.join(',\n'),
    '  },',
    '  "entries": [',
    entries.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
