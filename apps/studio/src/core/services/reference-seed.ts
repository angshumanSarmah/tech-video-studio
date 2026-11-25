import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  namesToAvoidOf,
  NamesToAvoidFileSchema,
  openNameSlots,
  type AvoidName,
} from '@explainer-studio/shared';
import { referenceBreakdownPath, resolveDataPath, writeDataText } from '../data-files.ts';
import type { Db, Executor } from '../db/client.ts';
import {
  getReferenceBySlug,
  insertReference,
  updateReference,
  type ReferenceRow,
} from '../db/repositories/references.ts';
import { findWorkspaceRoot } from '../workspace-root.ts';
import {
  checkReferenceRecord,
  markReferenceFailed,
  referenceCheckContext,
  saveReferenceRecord,
  withNames,
} from './references.ts';

/**
 * The six seed references (P1C.11), from committed files in `apps/studio/seed/references/`:
 * `<slug>.md` (the structure-only breakdown), `<slug>.record.json` (the Reference analyst's
 * record, recorded once by `reference:fixture --record` and reviewed) and `names-to-avoid.json`
 * (the originals' names, merged into each record). Seeding never calls a model. Idempotent: a
 * seed is written again only when its files' hash changes, so an edit made through the API
 * stays until then. A record that fails its checks (a catalogue id since removed) is stored as
 * `failed` with the reason; seeding goes on.
 */

/** Relative to the workspace root, like the prompts (works in dev and in the build). */
export const SEED_REFERENCES_DIR = 'apps/studio/seed/references';

export const NAMES_TO_AVOID_FILE = 'names-to-avoid.json';

/**
 * Part of every seed's hash: bump it when `saveReferenceRecord` changes what it writes from the
 * same files, so the next `db:migrate` saves every seed again. 2: beat devices left
 * `videoDevices` (P1C.11 R2).
 */
export const SEED_SAVE_VERSION = 2;

/** Each seed's names from the file, slots left out. */
type SeedNames = Readonly<Record<string, readonly AvoidName[]>>;

export interface SeedReferencesResult {
  inserted: number;
  updated: number;
  unchanged: number;
  failed: string[];
  /** Name slots in the names file still empty (`todo` entries), to fill by hand. */
  openSlots: { slug: string; todo: string }[];
}

export function defaultSeedReferencesDir(): string {
  return join(findWorkspaceRoot(import.meta.dirname), SEED_REFERENCES_DIR);
}

interface SeedFiles {
  readonly slug: string;
  readonly breakdown: string;
  readonly record: string | undefined;
  readonly hash: string;
}

export function seedReferences(
  db: Db,
  dataDir: string,
  seedDir: string = defaultSeedReferencesDir(),
): SeedReferencesResult {
  const result: SeedReferencesResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    failed: [],
    openSlots: [],
  };
  if (!existsSync(seedDir)) return result;
  const { names, openSlots } = readNames(seedDir);
  result.openSlots = openSlots;
  for (const seed of seedFiles(seedDir, names)) {
    const row = getReferenceBySlug(db, seed.slug);
    if (row && row.origin !== 'seed') continue; // a pasted reference took the name first
    if (row && row.seedHash === seed.hash && filesExist(dataDir, row)) {
      result.unchanged++;
      continue;
    }
    const ok = db.transaction((tx) => {
      const breakdownPath = writeDataText(
        dataDir,
        referenceBreakdownPath(seed.slug),
        seed.breakdown,
      );
      const target =
        row ??
        insertReference(tx, {
          slug: seed.slug,
          title: seed.slug,
          origin: 'seed',
          status: 'pending',
          breakdownPath,
        });
      return storeSeedRecord(tx, dataDir, target, seed, names[seed.slug] ?? []);
    });
    if (!ok) result.failed.push(seed.slug);
    if (row) result.updated++;
    else result.inserted++;
  }
  return result;
}

function storeSeedRecord(
  tx: Executor,
  dataDir: string,
  row: ReferenceRow,
  seed: SeedFiles,
  names: readonly AvoidName[],
): boolean {
  if (seed.record === undefined) {
    markReferenceFailed(tx, row.id, `No ${seed.slug}.record.json: run reference:fixture --record.`);
    updateReference(tx, row.id, { seedHash: seed.hash });
    return false;
  }
  const value: unknown = JSON.parse(seed.record);
  const checked = checkReferenceRecord(
    value,
    referenceCheckContext({ breakdown: seed.breakdown, extraNames: names }),
  );
  if ('issues' in checked) {
    const reasons = checked.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    markReferenceFailed(tx, row.id, `The committed record fails its checks: ${reasons}`);
    updateReference(tx, row.id, { seedHash: seed.hash });
    return false;
  }
  const record = withNames(checked.record, names);
  saveReferenceRecord(tx, dataDir, row, record, { seedHash: seed.hash });
  return true;
}

function readNames(seedDir: string): {
  names: SeedNames;
  openSlots: SeedReferencesResult['openSlots'];
} {
  const path = join(seedDir, NAMES_TO_AVOID_FILE);
  if (!existsSync(path)) return { names: {}, openSlots: [] };
  const file = NamesToAvoidFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const names = Object.fromEntries(
    Object.entries(file).map(([slug, entries]) => [slug, namesToAvoidOf(entries)]),
  );
  return { names, openSlots: openNameSlots(file) };
}

/** Each `<slug>.md` with its record (if committed), sorted by slug, and the hash of all three. */
function seedFiles(seedDir: string, names: SeedNames): SeedFiles[] {
  return readdirSync(seedDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const slug = file.slice(0, -'.md'.length);
      const breakdown = readFileSync(join(seedDir, file), 'utf8');
      const recordPath = join(seedDir, `${slug}.record.json`);
      const record = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : undefined;
      const hash = createHash('sha256')
        .update(`v${SEED_SAVE_VERSION}\0`)
        .update(breakdown)
        .update('\0')
        .update(record ?? '')
        .update('\0')
        .update(JSON.stringify(names[slug] ?? []))
        .digest('hex');
      return { slug, breakdown, record, hash };
    });
}

function filesExist(dataDir: string, row: ReferenceRow): boolean {
  const paths = [row.breakdownPath, ...(row.recordPath ? [row.recordPath] : [])];
  return paths.every((p) => existsSync(resolveDataPath(dataDir, p)));
}
