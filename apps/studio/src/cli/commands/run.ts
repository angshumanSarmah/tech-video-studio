import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  UPLOAD_EXTENSIONS,
  uploadExtension,
  type AddSourceRequest,
  type RunSettingsInput,
} from '@explainer-studio/shared';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { startRun } from '#core/services/runs.ts';
import { addSource, uploadSource, type Upload } from '#core/services/sources.ts';
import type { RunCommand, SeriesTag } from '../args.ts';
import { CliError, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { driveRun } from '../session.ts';

/**
 * `studio run` (P1C.9b): the topic, its sources and the run, through the same services as the
 * API, then the run followed. Every source is read and checked before anything is created, so a
 * typo in a path leaves no half-made topic behind.
 */
export async function runCommand(ctx: CliContext, cmd: RunCommand): Promise<number> {
  const seriesId = seriesIdOf(ctx, cmd.series);
  const sources = await readSources(ctx, cmd);
  return withWorker(ctx, cmd.dryRun, async () => {
    const topic = createTopic(ctx.db, {
      title: cmd.topic,
      ...(cmd.angle ? { notes: cmd.angle } : {}),
    });
    for (const source of sources) {
      if (source.kind === 'upload')
        uploadSource(ctx.db, ctx.config.dataDir, topic.id, source.upload);
      else addSource(ctx.db, ctx.config.dataDir, topic.id, source.request);
    }
    const { run } = startRun(ctx.db, {
      topicId: topic.id,
      seriesId,
      settings: runSettings(cmd),
      app: ctx.appSettings(),
    });
    ctx.io.out(
      `Run ${run.id} started: "${cmd.topic}" (topic ${topic.id}, ${sources.length} sources).`,
    );
    return driveRun(ctx, run.id, 0);
  });
}

/** Pure: the run's overrides from the flags. */
export function runSettings(cmd: RunCommand): RunSettingsInput {
  const video = {
    ...(cmd.level ? { explanationLevel: cmd.level } : {}),
    ...(cmd.wordsPerSec ? { wordsPerSec: cmd.wordsPerSec } : {}),
  };
  return {
    autoApprove: {
      research: cmd.auto,
      beat_sheet: cmd.auto,
      scenes: cmd.auto,
      draft: cmd.autoFinal,
    },
    ...(cmd.lengthSec ? { lengthOverrideSec: cmd.lengthSec } : {}),
    ...(cmd.format ? { format: cmd.format } : {}),
    ...(cmd.capUsd ? { budget: { maxRunUsd: cmd.capUsd } } : {}),
    ...(Object.keys(video).length > 0 ? { video } : {}),
  };
}

export function seriesIdOf(ctx: CliContext, tag: SeriesTag): number {
  const series = listSeries(ctx.db).find((s) => s.tag === tag);
  if (!series) throw new CliError(`No series "${tag}" in the database (run pnpm db:migrate).`);
  return series.id;
}

type ReadSource =
  | { readonly kind: 'upload'; readonly upload: Upload }
  | { readonly kind: 'request'; readonly request: AddSourceRequest };

async function readSources(ctx: CliContext, cmd: RunCommand): Promise<ReadSource[]> {
  const files = cmd.sources.map((source): ReadSource => {
    if (/^https?:\/\//i.test(source))
      return { kind: 'request', request: { kind: 'url', url: source } };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
      throw new CliError(`${source}: only http and https URLs are fetched.`);
    }
    if (!uploadExtension(source)) {
      throw new CliError(`${source}: only ${UPLOAD_EXTENSIONS.join(', ')} files are read.`);
    }
    return { kind: 'upload', upload: { name: basename(source), bytes: readFile(ctx, source) } };
  });
  const texts: ReadSource[] = [];
  for (const { title, path } of cmd.texts) {
    const text = path === '-' ? await ctx.io.readStdin() : readFile(ctx, path).toString();
    if (text.trim() === '') throw new CliError(`--text "${title}": the text is empty.`);
    texts.push({ kind: 'request', request: { kind: 'text', title, text } });
  }
  return [...files, ...texts];
}

function readFile(ctx: CliContext, path: string): Buffer {
  const full = isAbsolute(path) ? path : resolve(ctx.io.cwd, path);
  try {
    return readFileSync(full);
  } catch (error) {
    throw new CliError(`${full}: ${(error as NodeJS.ErrnoException).code ?? 'cannot be read'}.`);
  }
}
