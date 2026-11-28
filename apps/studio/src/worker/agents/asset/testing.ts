import { join } from 'node:path';
import { SettingsSchema } from '@explainer-studio/shared';
import type { Db } from '#core/db/client.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { draftAssetJobHandler } from '#worker/jobs/draft-asset.ts';
import { createJobRegistry } from '#worker/jobs/registry.ts';
import { createLlmClient } from '#worker/llm/client.ts';
import { dryRunTransport, type DryRunResponse } from '#worker/llm/dry-run.ts';
import { fakeTools } from '#worker/render/testing.ts';
import { runNextJob } from '#worker/runner.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../prompts/templates.ts';

/** Test-only helpers for the Asset drafter (P1C.12 A4). Not imported by any entrypoint. */

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Three hand-drawn variants that pass the sanitizer in draft mode (invented drawings). */
export const DRAFT_SVGS = [
  svg('<path d="M5 7c3 0 3 5 7 5s4 5 7 5" /><circle cx="5" cy="7" r="1.5" />'),
  svg('<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8" /><path d="M8 14h5" />'),
  svg('<path d="M6 4v16" /><path d="M12 6v12" /><path d="M18 4v16" />'),
] as const;

/** A variant the sanitizer refuses: a colour that is not a palette token. */
export const HEX_SVG = svg('<circle cx="12" cy="12" r="8" stroke="#ff0000" />');
/** A variant the sanitizer refuses outright: a script. */
export const SCRIPT_SVG = svg('<script>alert(1)</script><path d="M4 4h16" />');

export const CONCEPTS = ['A wavy line', 'A card with lines', 'Three bars'] as const;

/** The drafter's answer with these SVGs (the concepts in order). */
export function draftAnswer(svgs: readonly string[] = DRAFT_SVGS): DryRunResponse {
  const variants = svgs.map((s, i) => ({ concept: CONCEPTS[i] ?? `Idea ${i + 1}`, svg: s }));
  return { content: JSON.stringify({ variants }) };
}

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));

/**
 * A dry-run drafter: runs queued `draft_asset` jobs one at a time, the answers replayed in
 * order across them (repairs included), with a fake renderer whose sheet requests it keeps.
 */
export function draftRunner(db: Db, dataDir: string, answers: readonly DryRunResponse[]) {
  const transport = dryRunTransport({ asset: [...answers] });
  const llm = createLlmClient({ db, dataDir, llm: SettingsSchema.parse({}).llm, transport });
  const { tools, engine } = fakeTools();
  const registry = createJobRegistry([draftAssetJobHandler({ db, dataDir, llm, prompts, tools })]);
  const next = () =>
    runNextJob({ db, registry, workerId: 'test', signal: new AbortController().signal });
  return { next, sheets: engine.sheets };
}
