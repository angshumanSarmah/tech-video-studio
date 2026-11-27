import { writeFileSync } from 'node:fs';
import { defaultLucideManifestPath } from '#core/assets/lucide-import.ts';
import { buildLucideManifest, serializeLucideManifest } from '#core/assets/lucide-manifest.ts';
import { lucideManifestInput } from './lucide-sources.ts';

/**
 * `pnpm --filter @explainer-studio/studio assets:manifest`: rebuilds the committed Lucide
 * manifest (`seed/assets/lucide.manifest.json`) from the installed `lucide` and `lucide-static`
 * and prints counts per family and per skip reason. Review the file's diff before committing.
 */

const manifest = buildLucideManifest(lucideManifestInput());
const path = defaultLucideManifestPath();
writeFileSync(path, serializeLucideManifest(manifest));

const imported = manifest.entries.filter((e) => e.status === 'import');
const skipped = manifest.entries.filter((e) => e.status === 'skip');
console.log(`Wrote ${path} (lucide@${manifest.lucideVersion}, rules v${manifest.rulesVersion})`);
console.log(
  `Imported ${imported.length}, skipped ${skipped.length}, ` +
    `aliases ${Object.keys(manifest.aliases).length}`,
);
console.log('Families:', counts(imported.map((e) => e.family)));
console.log('Skipped:', counts(skipped.map((e) => e.reason)));

function counts(values: readonly string[]): string {
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally]
    .sort(([, a], [, b]) => b - a)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
}
