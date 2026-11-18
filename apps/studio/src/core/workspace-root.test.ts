import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from './workspace-root.ts';

describe('findWorkspaceRoot', () => {
  it('finds the nearest directory containing pnpm-workspace.yaml', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
    const nested = join(root, 'apps', 'studio', 'src');
    mkdirSync(nested, { recursive: true });

    expect(findWorkspaceRoot(nested)).toBe(root);
  });

  it('throws when no workspace root exists', () => {
    const orphan = mkdtempSync(join(tmpdir(), 'orphan-'));
    expect(() => findWorkspaceRoot(orphan)).toThrow(/pnpm-workspace\.yaml/);
  });
});
