import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReferenceRecordSchema, type ReferenceRecord } from '@explainer-studio/shared';
import { findWorkspaceRoot } from '../workspace-root.ts';
import { SEED_REFERENCES_DIR } from './reference-seed.ts';

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

/** An empty seed folder: a database with no seed references. */
export function noSeedReferences(): { seedReferencesDir: string } {
  return { seedReferencesDir: mkdtempSync(join(tmpdir(), 'no-seed-references-')) };
}
