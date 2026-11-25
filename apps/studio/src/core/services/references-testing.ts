import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  namesToAvoidOf,
  NamesToAvoidFileSchema,
  ReferenceRecordSchema,
  type AvoidName,
  type ReferenceRecord,
} from '@explainer-studio/shared';
import { findWorkspaceRoot } from '../workspace-root.ts';
import { NAMES_TO_AVOID_FILE, SEED_REFERENCES_DIR } from './reference-seed.ts';
import { settleReferenceRecord, withNames } from './references.ts';

/** Test-only helpers for the reference library (P1C.11). Not imported by any entrypoint. */

/** The six committed seeds, in the order `reference:fixture` records them. */
export const SEED_SLUGS = [
  'database-failover-split-brain',
  'food-delivery-eta',
  'live-score-fanout',
  'quick-commerce-dark-store',
  'ride-hailing-demand-heatmap',
  'seat-booking-contention',
] as const;

const seedDir = join(findWorkspaceRoot(import.meta.dirname), SEED_REFERENCES_DIR);

export function seedBreakdown(slug: string): string {
  return readFileSync(join(seedDir, `${slug}.md`), 'utf8');
}

/** A seed's committed record, as the analyst returned it. */
export function seedRecord(slug: string): ReferenceRecord {
  return ReferenceRecordSchema.parse(
    JSON.parse(readFileSync(join(seedDir, `${slug}.record.json`), 'utf8')),
  );
}

/** A seed's record as the library saves it from the analyst (`settleReferenceRecord`). */
export function savedSeedRecord(slug: string): ReferenceRecord {
  return settleReferenceRecord(seedRecord(slug), seedBreakdown(slug));
}

/** A seed's names in `names-to-avoid.json`, slots left out. */
export function seedNames(slug: string): AvoidName[] {
  const file = NamesToAvoidFileSchema.parse(
    JSON.parse(readFileSync(join(seedDir, NAMES_TO_AVOID_FILE), 'utf8')),
  );
  return namesToAvoidOf(file[slug]);
}

/** A seed's record as seeding saves it: the names file's names merged in. */
export function seededRecord(slug: string): ReferenceRecord {
  return settleReferenceRecord(withNames(seedRecord(slug), seedNames(slug)), seedBreakdown(slug));
}

/** An empty seed folder: a database with no seed references. */
export function noSeedReferences(): { seedReferencesDir: string } {
  return { seedReferencesDir: mkdtempSync(join(tmpdir(), 'no-seed-references-')) };
}
