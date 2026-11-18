import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MARKER = 'pnpm-workspace.yaml';

/** Walks up from `startDir` until it finds the pnpm workspace root. */
export function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, MARKER))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not find ${MARKER} above ${startDir}`);
    dir = parent;
  }
  return dir;
}
