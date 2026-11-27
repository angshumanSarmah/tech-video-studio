import { SEED_REGISTRY, SEED_SOURCE_PREFIX } from '@explainer-studio/renderer/catalog';
import { ASSET_FAMILIES, type LibraryAsset } from '@explainer-studio/shared';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadAssetLibrary } from '#core/assets/library.ts';
import { loadConfig } from '#core/config.ts';
import { closeDatabase, dbPathFor, openDatabase } from '#core/db/client.ts';
import { renderAssetSheet } from '#worker/render/asset-sheet.ts';
import { pickSheetAssets } from './asset-sheet-pick.ts';

/**
 * `pnpm --filter @explainer-studio/studio assets:sheet [--count 30] [--ids a,b,…] [--family f]
 * [--core] [--theme <id>] [--out <png>]`: a contact sheet of approved library assets from the
 * data dir's database (run `pnpm db:migrate` first). By default `--count` imported icons (not
 * the core seed set) sampled across families; `--core` samples the whole library instead.
 * Writes `<DATA_DIR>/sheets/assets-<…>.png`.
 */

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    count: { type: 'string', default: '30' },
    ids: { type: 'string' },
    family: { type: 'string' },
    core: { type: 'boolean', default: false },
    theme: { type: 'string' },
    out: { type: 'string' },
  },
});

const config = loadConfig();
const db = openDatabase(dbPathFor(config.dataDir));
const library = (() => {
  try {
    return loadAssetLibrary(db, config.dataDir);
  } finally {
    closeDatabase(db);
  }
})();
for (const p of library.problems) console.warn(`[skip] ${p.id}: ${p.message}`);

const chosen = choose(library.assets);
if (chosen.length === 0) {
  console.error('No assets match. Has `pnpm db:migrate` seeded the Lucide import?');
  process.exit(1);
}
const name = values.ids
  ? 'selection'
  : `${values.core ? 'library' : 'imported'}-${values.family ?? 'all'}`;
const outPath = values.out
  ? resolve(process.env.INIT_CWD ?? process.cwd(), values.out)
  : join(config.dataDir, 'sheets', `assets-${name}.png`);
const title = values.ids
  ? `${chosen.length} assets`
  : `${chosen.length} ${values.core ? 'library' : 'imported'} assets${values.family ? ` · ${values.family}` : ' across families'}`;
await renderAssetSheet({
  assets: chosen,
  title,
  outPath,
  ...(values.theme ? { themeId: values.theme } : {}),
});
console.log(`Wrote ${outPath}`);
for (const a of chosen) console.log(`  ${a.family.padEnd(9)} ${a.id.padEnd(28)} ${a.source}`);

function choose(assets: readonly LibraryAsset[]): LibraryAsset[] {
  if (values.ids) {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const ids = values.ids.split(',').map((id) => id.trim());
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) console.warn(`Not in the library: ${unknown.join(', ')}`);
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
  const family = values.family;
  if (family !== undefined && !(ASSET_FAMILIES as readonly string[]).includes(family)) {
    console.error(`Unknown family "${family}": ${ASSET_FAMILIES.join(', ')}`);
    process.exit(2);
  }
  const pool = assets.filter(
    (a) =>
      (values.core || (!SEED_REGISTRY.has(a.id) && a.source.startsWith(SEED_SOURCE_PREFIX))) &&
      (family === undefined || a.family === family),
  );
  return pickSheetAssets(pool, Number(values.count));
}
