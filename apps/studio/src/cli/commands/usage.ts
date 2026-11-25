import { USAGE_KINDS, type UsageSummary } from '@explainer-studio/shared';
import { usageSummary } from '#core/services/usage-history.ts';
import { EXIT, type CliContext } from '../context.ts';
import { clip } from '../summaries.ts';

/** `studio usage [--videos <n>]` (P1C.10): what the last exported videos used. */
export function usageCommand(ctx: CliContext, videos: number): number {
  for (const line of usageLines(usageSummary(ctx.db, videos))) ctx.io.out(line);
  return EXIT.ok;
}

const WIDTH = 100;

/** Pure: each video's structure, newest first, then per kind each value with its video count. */
export function usageLines(summary: UsageSummary): string[] {
  const { videos, counts } = summary;
  if (videos.length === 0) {
    return ['No exported videos yet: usage is recorded when a video’s final is exported.'];
  }
  const header = `Usage over the last ${videos.length} exported video(s), newest first:`;
  const rows = videos.flatMap((v) => {
    const parts = v.runIds.length > 1 ? ` (parts: runs ${v.runIds.join(', ')})` : '';
    const date = v.exportedAt.slice(0, 10);
    const structure = [
      `hook ${v.hooks.join(', ') || '-'}`,
      `ending ${v.endings.join(', ') || '-'}`,
      `patterns ${v.sequences.join(', ') || '-'}`,
    ].join(' · ');
    return [
      `  ${clip(`run ${v.videoRunId} · ${date} · "${v.title ?? '(untitled)'}"${parts}`, WIDTH)}`,
      `      ${structure}`,
    ];
  });
  const kinds = USAGE_KINDS.filter((kind) => counts[kind].length > 0).map(
    (kind) =>
      `  ${kind.padEnd(17)} ${clip(counts[kind].map((c) => `${c.value} ${c.videos}`).join(' · '), WIDTH - 20)}`,
  );
  return [header, ...rows, 'Videos using each value:', ...kinds];
}
