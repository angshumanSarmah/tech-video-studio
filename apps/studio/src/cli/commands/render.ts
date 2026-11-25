import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { withRegistryChecks } from '@explainer-studio/renderer/catalog';
import { validateRenderableVideoSpec } from '@explainer-studio/shared';
import { startRenderRun } from '#core/services/render-run.ts';
import type { Command } from '../args.ts';
import { CliError, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { driveRun } from '../session.ts';
import { seriesIdOf } from './run.ts';

type RenderCommand = Extract<Command, { kind: 'render' }>;

/**
 * `studio render <spec.json>` (P1C.9b): a saved spec rendered with no LLM calls
 * (`startRenderRun`): the draft and stills, then gate 4; `--final` approves it when nothing
 * blocks the final and exports the MP4 and SRT. A spec without a timing layer renders silent,
 * with estimated timing, and the final refuses it.
 */
export async function renderCommand(ctx: CliContext, cmd: RenderCommand): Promise<number> {
  const path = isAbsolute(cmd.file) ? cmd.file : resolve(ctx.io.cwd, cmd.file);
  const spec = readSpec(path);
  const checked = withRegistryChecks(validateRenderableVideoSpec(spec), spec);
  if (!checked.ok) {
    const issues = checked.errors.map((e) => `  · ${e.code} at ${e.path}: ${e.message}`);
    throw new CliError([`${path} is not a renderable spec:`, ...issues].join('\n'));
  }
  for (const w of checked.warnings) ctx.io.err(`  ! ${w.code} at ${w.path}: ${w.message}`);
  const seriesId = seriesIdOf(ctx, cmd.series);
  return withWorker(ctx, cmd.dryRun, async () => {
    const run = startRenderRun(ctx.db, ctx.config.dataDir, {
      spec: checked.spec,
      label: basename(path),
      seriesId,
      final: cmd.final,
      app: ctx.appSettings(),
    });
    ctx.io.out(
      `Run ${run.id} renders ${basename(path)} (${cmd.final ? 'draft, then final' : 'draft'}).`,
    );
    return driveRun(ctx, run.id, 0);
  });
}

function readSpec(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError(`${path}: ${(error as Error).message}`);
  }
}
