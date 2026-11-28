import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspaceRoot } from '#core/workspace-root.ts';

/**
 * The house style the Asset drafter reads (P1C.12 A4): every span of `docs/asset-style.md`
 * between a `<!-- drafter -->` line and a `<!-- /drafter -->` line (file format, stroke, palette
 * tokens, drawing), so the doc stays the one source of the rules and its sanitizer and metadata
 * notes stay out of the prompt.
 */

export const ASSET_STYLE_DOC = 'docs/asset-style.md';

const OPEN = /^<!-- drafter -->$/;
const CLOSE = /^<!-- \/drafter -->$/;

/** The marked spans, in order, joined by a blank line. Pure. */
export function drafterSections(markdown: string): string {
  const spans: string[][] = [];
  let current: string[] | null = null;
  for (const line of markdown.split('\n')) {
    if (OPEN.test(line.trim())) current = [];
    else if (CLOSE.test(line.trim())) {
      if (current) spans.push(current);
      current = null;
    } else current?.push(line);
  }
  const text = spans.map((s) => s.join('\n').trim()).filter(Boolean);
  if (text.length === 0) throw new Error(`${ASSET_STYLE_DOC} has no <!-- drafter --> section.`);
  return text.join('\n\n');
}

let cached: string | undefined;

/** The drafter's house style, read once per process from the workspace's doc. */
export function houseStyleText(): string {
  cached ??= drafterSections(
    readFileSync(join(findWorkspaceRoot(import.meta.dirname), ASSET_STYLE_DOC), 'utf8'),
  );
  return cached;
}
