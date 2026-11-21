import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelRole } from '@explainer-studio/shared';

/**
 * Agent prompt files: `<name>.v<version>.md` in this directory, copied verbatim from the design
 * doc's "Agent system prompts (v1)" section. Change the doc first, add the next version's file,
 * then bump the version here; every LLM call records the versions it used.
 */

/** Roles with a role prompt. `asset` has none yet (its rules come with P1C.12). */
export const PROMPT_ROLES = [
  'researcher',
  'director',
  'scriptwriter',
  'generator',
  'curator',
  'analyst',
] as const satisfies readonly ModelRole[];
export type PromptRole = (typeof PROMPT_ROLES)[number];

export type PromptName = 'preamble' | PromptRole;

export const PROMPT_VERSIONS: Readonly<Record<PromptName, number>> = {
  preamble: 1,
  researcher: 3,
  director: 3,
  scriptwriter: 5,
  generator: 1,
  curator: 1,
  analyst: 1,
};

/** Relative to the workspace root, like other repo paths in config (works in dev and build). */
export const PROMPTS_DIR = 'apps/studio/src/worker/agents/prompts';

export function promptFileName(name: PromptName, version = PROMPT_VERSIONS[name]): string {
  return `${name}.v${version}.md`;
}

/** The id recorded on `llm_calls`, e.g. `director@v1`. */
export function promptId(name: PromptName, version = PROMPT_VERSIONS[name]): string {
  return `${name}@v${version}`;
}

export interface PromptTemplate {
  readonly id: string;
  readonly text: string;
}

export type PromptTemplates = Readonly<Record<PromptName, PromptTemplate>>;

/** Reads the current version of every prompt file once (the worker keeps them in memory). */
export function loadPromptTemplates(promptsDir: string): PromptTemplates {
  const names: PromptName[] = ['preamble', ...PROMPT_ROLES];
  return Object.fromEntries(
    names.map((name) => [
      name,
      { id: promptId(name), text: readFileSync(join(promptsDir, promptFileName(name)), 'utf8') },
    ]),
  ) as Record<PromptName, PromptTemplate>;
}
