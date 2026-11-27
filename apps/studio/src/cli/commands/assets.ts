import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { uploadAsset } from '#core/services/asset-upload.ts';
import type { AssetsCommand } from '../args.ts';
import { CliError, EXIT, type CliContext } from '../context.ts';

/** `studio assets …` (P1C.12): the asset library through the same services as the API. */
export function assetsCommand(ctx: CliContext, cmd: AssetsCommand): number {
  const path = isAbsolute(cmd.file) ? cmd.file : resolve(ctx.io.cwd, cmd.file);
  if (!existsSync(path)) throw new CliError(`No such file: ${cmd.file}`);
  try {
    const { asset, fixes } = uploadAsset(ctx.db, ctx.config.dataDir, {
      svg: readFileSync(path, 'utf8'),
      id: cmd.id,
      name: cmd.name,
      family: cmd.family,
      tags: cmd.tags,
      aliases: cmd.aliases,
      ...(cmd.description ? { description: cmd.description } : {}),
      ...(cmd.licence ? { licence: cmd.licence } : {}),
      ...(cmd.source ? { source: cmd.source } : {}),
    });
    ctx.io.out(
      `Added ${asset.id} (${asset.family}, ${asset.licence}): ${asset.svgPath}, approved.`,
    );
    for (const fix of fixes) ctx.io.out(`  fixed: ${fix}`);
    return EXIT.ok;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'InvalidEditError') throw error;
    const issues = (error as Error & { issues: readonly { path: string; message: string }[] })
      .issues;
    ctx.io.err(error.message);
    for (const issue of issues) ctx.io.err(`  ${issue.path}: ${issue.message}`);
    return EXIT.failed;
  }
}
