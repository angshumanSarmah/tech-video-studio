import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import {
  loadPromptTemplates,
  promptFileName,
  PROMPT_ROLES,
  PROMPTS_DIR,
  type PromptName,
} from './templates.ts';

/**
 * The prompt files are copies of the design doc's "Agent system prompts" section. The doc is the
 * source: change it first, then add the next version's file, bump `PROMPT_VERSIONS` and delete
 * the version it replaces. Only live versions are kept: every call's prompt file holds the full
 * messages it sent, and git keeps the old files.
 */
const root = findWorkspaceRoot(import.meta.dirname);
const DOC = 'Tech Explainer Studio Design and Claude Code Prompts.md';

const HEADINGS: Record<PromptName, string> = {
  preamble: 'Shared preamble (every agent)',
  researcher: 'Researcher',
  director: 'Director',
  scriptwriter: 'Scriptwriter',
  generator: 'Generator',
  curator: 'Curator (review and repair)',
  analyst: 'Analyst (memory rules)',
  reference: 'Reference analyst',
  asset: 'Asset drafter',
};

/** `**Heading**` followed by a ```text block, inside the "## Agent system prompts" section. */
function docPrompts(doc: string): Map<string, string> {
  const start = doc.search(/^## Agent system prompts \(v\d+\)$/m);
  if (start < 0) throw new Error('Design doc has no "Agent system prompts" section');
  const next = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, next < 0 ? undefined : next);
  const blocks = new Map<string, string>();
  for (const match of section.matchAll(/^\*\*([^*\n]+)\*\*\n\n```text\n([\s\S]*?)\n```$/gm)) {
    blocks.set(match[1]!, `${match[2]!}\n`);
  }
  return blocks;
}

const fromDoc = docPrompts(readFileSync(join(root, DOC), 'utf8'));
const files = loadPromptTemplates(join(root, PROMPTS_DIR));

describe('agent prompt files', () => {
  it('cover every prompt in the design doc, and nothing else', () => {
    expect([...fromDoc.keys()].sort()).toEqual(Object.values(HEADINGS).sort());
  });

  it.each(['preamble', ...PROMPT_ROLES] as PromptName[])(
    '%s matches the design doc verbatim',
    (name) => {
      expect(files[name].text).toBe(fromDoc.get(HEADINGS[name]));
    },
  );

  it('holds only the live version of each prompt', () => {
    const live = (['preamble', ...PROMPT_ROLES] as PromptName[]).map((name) =>
      promptFileName(name),
    );
    const onDisk = readdirSync(join(root, PROMPTS_DIR)).filter((f) => f.endsWith('.md'));
    expect(onDisk.sort()).toEqual(live.sort());
  });
});
