import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_SUBDIRS = ['runs', 'assets', 'exports'] as const;

/** Idempotently creates the runtime data layout under `dataDir`. */
export function ensureDataDirs(dataDir: string): void {
  for (const sub of DATA_SUBDIRS) mkdirSync(join(dataDir, sub), { recursive: true });
}
