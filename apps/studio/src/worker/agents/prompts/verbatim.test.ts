import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import {
  loadPromptTemplates,
  promptFileName,
  PROMPT_ROLES,
  PROMPT_VERSIONS,
  PROMPTS_DIR,
  type PromptName,
} from './templates.ts';

/**
 * The prompt files are copies of the design doc's "Agent system prompts" section. The doc is the
 * source: change it first, then add the next version's file and bump `PROMPT_VERSIONS`. Only the
 * current version must match the doc; earlier versions stay as they were, for the calls that
 * recorded them.
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

  it.each(['preamble', ...PROMPT_ROLES] as PromptName[])(
    '%s keeps every earlier version for history',
    (name) => {
      const versions = Array.from({ length: PROMPT_VERSIONS[name] }, (_, i) => i + 1);
      for (const version of versions) {
        const path = join(root, PROMPTS_DIR, promptFileName(name, version));
        expect(() => readFileSync(path, 'utf8'), path).not.toThrow();
      }
    },
  );
});
