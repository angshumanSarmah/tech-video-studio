import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Resident memory of a process and all its descendants (Node, the Chrome it drives, the
 * compositor and ffmpeg), in KiB, from `ps -A -o pid=,ppid=,rss=` output. Pure.
 */
export function treeRssKb(psOutput: string, rootPid: number): number {
  const rows = psOutput
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((r): r is [number, number, number] => r.length === 3 && r.every(Number.isFinite));
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const [pid, ppid, kb] of rows) {
    rss.set(pid, kb);
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  let total = 0;
  const stack = [rootPid];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}

/** Samples this process tree's RSS every `intervalMs` and keeps the peak (macOS and Linux). */
export function startMemorySampler(intervalMs = 250) {
  let peakKb = 0;
  let overallKb = 0;
  let stopped = false;
  const sample = async () => {
    try {
      const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,rss=']);
      const kb = treeRssKb(stdout, process.pid);
      peakKb = Math.max(peakKb, kb);
      overallKb = Math.max(overallKb, kb);
    } catch {
      // A failed sample only lowers the resolution of the peak.
    }
  };
  const loop = async () => {
    while (!stopped) {
      await sample();
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };
  const done = loop();
  return {
    /** Peak since the last reset (one phase), in MiB. */
    peakMb: () => peakKb / 1024,
    /** Starts a new phase; the overall peak is kept. */
    reset: () => {
      peakKb = 0;
    },
    /** Stops sampling; resolves with the overall peak since the start, in MiB. */
    stop: async () => {
      stopped = true;
      await done;
      return overallKb / 1024;
    },
  };
}
