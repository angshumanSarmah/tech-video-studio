import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRunGates } from '#core/db/repositories/gates.ts';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { readWorkerLock } from '#core/services/worker-lock.ts';
import { topicDryRunFixtures, writeDryRunDir } from '#worker/agents/fixture-dry-run.ts';
import {
  FIXTURE_WORDS_PER_SEC,
  fixtureTopic,
  type FixtureTopicId,
} from '#worker/agents/fixture-topics.ts';
import { dryRunTransport } from '#worker/llm/dry-run.ts';
import { startWorker } from '#worker/runtime.ts';
import { runCli } from './cli.ts';
import { cliContext, fakeIo, testConfig, type FakeIo } from './testing.ts';

/**
 * P1C.9b's acceptance, through `runCli` as the terminal calls it: a dry-run topic from its
 * invented sources to its draft (gate 1 waits on the recorded disagreement, approved by the next
 * command), `resume --only generate` running only the Generator (and the review gate 3 needs),
 * the gate prompt in a terminal, and a CLI that attaches to the `pnpm dev` worker.
 */

const TOPIC: FixtureTopicId = 'tokenizer';

let t: TestDb;
let dryRun: string;

beforeEach(() => {
  t = createTestDb();
  dryRun = writeDryRunDir(
    topicDryRunFixtures(TOPIC),
    join(mkdtempSync(join(tmpdir(), 'studio-cli-')), 'dry-run'),
  );
});

afterEach(() => t.cleanup());

function runArgs(...extra: string[]): string[] {
  const { topic, sourceFiles } = fixtureTopic(TOPIC);
  return [
    'run',
    topic.title,
    '--series',
    'ai',
    ...sourceFiles.flatMap((f) => ['--source', f]),
    '--angle',
    topic.notes,
    '--words-per-sec',
    String(FIXTURE_WORDS_PER_SEC),
    '--dry-run',
    dryRun,
    ...extra,
  ];
}

const cli = (io: FakeIo, argv: readonly string[]) => runCli(argv, cliContext(t, io, TOPIC));

/** Each test runs a whole pipeline (or three commands of one) end to end. */
const PIPELINE_TIMEOUT = { timeout: 30_000 };

describe('studio CLI, dry run', PIPELINE_TIMEOUT, () => {
  it('takes a topic to its draft from the terminal: gate 1 stops it, `gate approve` goes on', async () => {
    const first = fakeIo();
    expect(await cli(first, runArgs('--auto'))).toBe(0);
    expect(first.lines[0]).toBe(
      `Run 1 started: "${fixtureTopic(TOPIC).topic.title}" (topic 1, 3 sources).`,
    );
    expect(first.lines).toContain('run 1 ▸ research');
    expect(first.lines).toContain('── Gate 1: research notes · run 1 ──');
    expect(first.lines.some((l) => l.startsWith('  ✗ sources_disagree at $.openQuestions'))).toBe(
      true,
    );
    expect(first.lines).toContain('  pnpm studio gate 1 approve');
    expect(getRun(t.db, 1)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_research',
    });
    // The worker this command ran is gone, and so is its lock.
    expect(readWorkerLock(t.db)).toBeUndefined();

    const second = fakeIo();
    expect(await cli(second, ['gate', '1', 'approve', '--dry-run', dryRun])).toBe(0);
    expect(second.lines[0]).toBe('approve at gate research: the run is running at direct.');
    expect(getRun(t.db, 1)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_draft',
    });
    expect(second.lines).toContain('── Gate 4: draft · run 1 ──');
    expect(second.lines).toContain(`Draft: ${join(t.dataDir, 'runs/1/draft.mp4')}`);
    expect(second.lines).toContain('  pnpm studio gate 1 approve');
    expect(listRunGates(t.db, 1).map((g) => [g.gate, g.status, g.decidedBy])).toEqual([
      ['research', 'approved', 'user'],
      ['beat_sheet', 'approved', 'auto'],
      ['scenes', 'approved', 'auto'],
      ['draft', 'pending', null],
    ]);
  });

  it('`resume --only generate` reruns only the Generator, then waits at gate 3 though it is on auto', async () => {
    await cli(fakeIo(), runArgs('--auto'));
    await cli(fakeIo(), ['gate', '1', 'approve', '--dry-run', dryRun]);
    const before = listRunLlmCalls(t.db, 1).length;

    const io = fakeIo();
    expect(await cli(io, ['resume', '1', '--only', 'generate', '--dry-run', dryRun])).toBe(0);
    expect(io.lines[0]).toBe('Run 1: rerunning generate only.');

    const rerun = listRunLlmCalls(t.db, 1).slice(before);
    expect(new Set(rerun.map((c) => c.role))).toEqual(new Set(['generator', 'curator']));
    expect(rerun.filter((c) => c.role === 'generator').length).toBeGreaterThanOrEqual(7);
    expect(getRun(t.db, 1)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_scenes',
      holdGate: 'scenes',
    });
    expect(getRun(t.db, 1)!.settings.autoApprove.scenes).toBe(true);
    const jobs = listRunJobs(t.db, 1);
    const after = jobs.slice(jobs.findLastIndex((j) => j.type === 'generate'));
    expect(after.map((j) => j.type)).toEqual(['generate', 'tts', 'curate', 'render_stills']);
    expect(after[0]!.payload).toMatchObject({ redraw: true });
    expect(after[2]!.payload).toMatchObject({ repair: false });
    expect(io.lines).toContain('── Gate 3: scenes · run 1 ──');
    expect(listRunGates(t.db, 1).find((g) => g.gate === 'draft')!.status).toBe('pending');

    // Approving it releases the hold, and the run goes on to its draft.
    await cli(fakeIo(), ['gate', '1', 'approve', '--dry-run', dryRun]);
    expect(getRun(t.db, 1)).toMatchObject({ pipelineStep: 'gate_draft', holdGate: null });
  });

  it('asks at each gate in a terminal: approve goes on, quit leaves the run waiting', async () => {
    const io = fakeIo(['nonsense', 'a', 'q']);
    expect(await cli(io, runArgs('--auto'))).toBe(0);
    expect(io.errors).toContain('Type a, r, e, x or q (not "nonsense").');
    expect(io.transcript.filter((l) => l.startsWith('[a]pprove'))).toHaveLength(3);
    expect(getRun(t.db, 1)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_draft',
    });
    expect(io.lines.at(-1)).toBe('  pnpm studio gate 1 reject [--notes "<why>"]');
  });
});

describe('studio CLI, style rules (P1C.10)', PIPELINE_TIMEOUT, () => {
  const RULE = 'Keep every headline to a few words.';

  it('turns a gate note into a rule in a terminal, then manages rules with `rules`', async () => {
    writeFileSync(
      join(dryRun, 'analyst.json'),
      JSON.stringify([
        { content: JSON.stringify({ rule: { text: RULE, scope: 'scriptwriter', why: '<why>' } }) },
      ]),
    );
    const io = fakeIo(['x "Headlines read like whole sentences."', 'y', 'a']);
    expect(await cli(io, runArgs('--auto'))).toBe(1); // rejected: the run is cancelled
    expect(io.transcript).toContain('Propose a style rule from this note? [y/N] ');
    expect(io.lines).toContain('The Analyst will propose a style rule from your note (job 3).');
    expect(io.lines).toContain(`Style rule 1 proposed (scriptwriter): ${RULE}`);
    expect(io.lines).toContain(`Style rule 1 is active (scriptwriter): ${RULE}`);

    const list = fakeIo();
    expect(await cli(list, ['rules'])).toBe(0);
    expect(list.lines).toEqual([`  rule 1 [scriptwriter, active]: ${RULE}`]);
    const off = fakeIo();
    expect(await cli(off, ['rules', 'off', '1'])).toBe(0);
    expect(off.lines).toEqual([`rule 1 [scriptwriter, inactive]: ${RULE}`]);
    const added = fakeIo();
    expect(
      await cli(added, ['rules', 'add', '--scope', 'curator', 'Do not flag contractions.']),
    ).toBe(0);
    expect(added.lines).toEqual(['Added: rule 2 [curator, active]: Do not flag contractions.']);

    // One proposal per note: asked again from the same gate, the CLI says why not.
    const again = fakeIo();
    const args = ['rules', 'propose', '--run', '1', '--gate', 'research', '--dry-run', dryRun];
    expect(await cli(again, args)).toBe(1);
    expect(again.errors.at(-1)).toMatch(/^Rule 1 was already proposed from event \d+\.$/);
  });
});

describe('studio CLI next to pnpm dev', PIPELINE_TIMEOUT, () => {
  it('attaches when the dev worker holds the lock: that worker runs the jobs', async () => {
    const inner = dryRunTransport(topicDryRunFixtures(TOPIC));
    const devCalls: string[] = [];
    const dev = startWorker({
      config: { ...testConfig(t.dataDir), llmDryRunDir: dryRun },
      db: t.db,
      kind: 'worker',
      log: () => undefined,
      parts: {
        ...cliContext(t, fakeIo(), TOPIC).workerParts,
        transport: {
          send: (request) => {
            devCalls.push(request.role);
            return inner.send(request);
          },
        },
      },
      pollIntervalMs: 10,
    });
    try {
      expect(dev.holdsLock()).toBe(true);
      const io = fakeIo();
      expect(await cli(io, runArgs('--auto'))).toBe(0);
      const host = readWorkerLock(t.db)!.host;
      expect(io.errors).toContain(
        `Attached: the worker (pnpm dev or start), pid ${process.pid} on ${host}, dry run runs ` +
          'the jobs; following the run here.',
      );
      expect(getRun(t.db, 1)!.pipelineStep).toBe('gate_research');
      // The Researcher was called through the dev worker, not this CLI's.
      expect(devCalls).toEqual(['researcher']);
      expect(listRunLlmCalls(t.db, 1)).toHaveLength(1);
      expect(readWorkerLock(t.db)!.holder).toBe(dev.holder.holder);
    } finally {
      await dev.stop();
    }
  });

  it('refuses a dry run next to a live dev worker, before creating anything', async () => {
    const dev = startWorker({
      config: testConfig(t.dataDir),
      db: t.db,
      kind: 'worker',
      log: () => undefined,
      parts: cliContext(t, fakeIo(), TOPIC).workerParts!,
      pollIntervalMs: 10,
    });
    try {
      const io = fakeIo();
      expect(await cli(io, runArgs())).toBe(1);
      expect(io.errors.join('\n')).toMatch(/LLM mode does not match .* drop --dry-run/);
      expect(getRun(t.db, 1)).toBeUndefined();
    } finally {
      await dev.stop();
    }
  });
});
