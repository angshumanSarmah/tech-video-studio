import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listReferenceBacklog } from '#core/db/repositories/backlog.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { readReferenceRecord, requireReference } from '#core/services/references.ts';
import { seedBreakdown, seededRecord, seedRecord } from '#worker/agents/reference/testing.ts';
import { avoidName, parseCommand, UsageError } from './args.ts';
import { runCli } from './cli.ts';
import { cliContext, fakeIo } from './testing.ts';

/** `studio references …` (P1C.11) through `runCli`, with the analyst replayed. */

let t: TestDb;
let dir: string;

beforeEach(() => {
  t = createTestDb();
  dir = mkdtempSync(join(tmpdir(), 'studio-cli-references-'));
});
afterEach(() => t.cleanup());

/** A dry-run directory whose Reference analyst answers with these records, in order. */
function dryRunWith(...records: unknown[]): string {
  const at = join(dir, 'dry-run');
  mkdirSync(at, { recursive: true });
  const answers = records.map((r) => ({ content: JSON.stringify(r) }));
  writeFileSync(join(at, 'reference.json'), JSON.stringify(answers));
  return at;
}

async function cli(args: string[], io = fakeIo()) {
  const code = await runCli(args, cliContext(t, io, 'tokenizer'));
  return { code, io, out: io.lines.join('\n') };
}

describe('studio references', () => {
  it('lists the six seeds and shows one', async () => {
    const list = await cli(['references']);
    expect(list.code).toBe(0);
    expect(list.io.lines).toHaveLength(6);
    expect(list.out).toMatch(/seat-booking-contention\s+ready\s+product-design/);

    const shown = await cli(['references', 'show', 'ride-hailing-demand-heatmap']);
    expect(shown.out).toContain('hook problem/contention_hook');
    expect(shown.out).toMatch(/backlog #\d+ hex_grid_equidistance \[open\]/);

    const json = await cli(['references', 'show', '1', '--json']);
    expect(JSON.parse(json.out)).toEqual(seededRecord('database-failover-split-brain'));

    const missing = await cli(['references', 'show', 'no-such-reference']);
    expect(missing.code).toBe(1);
    expect(missing.io.errors.join('\n')).toMatch(/No reference "no-such-reference"/);
  });

  it('adds a breakdown with a screenshot; its missing primitive goes to the backlog', async () => {
    const file = join(dir, 'breakdown.md');
    writeFileSync(file, seedBreakdown('live-score-fanout'));
    const shot = join(dir, 'frame.png');
    writeFileSync(shot, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const record = {
      ...seedRecord('live-score-fanout'),
      unmapped: [
        {
          kind: 'primitive',
          name: 'scoreboard_flip',
          description: 'A split-flap board whose digits flip to a new score.',
          buildable: 'yes',
        },
      ],
    };
    const args = ['references', 'add', file, '--title', 'Score fan-out', '--avoid', 'Scorely'];
    const added = await cli([...args, '--attach', shot, '--dry-run', dryRunWith(record)]);
    expect(added.code).toBe(0);
    expect(added.out).toContain('Reference score-fan-out added, 1 screenshot(s) kept');
    expect(added.out).toMatch(/backlog #\d+ scoreboard_flip \[open\]/);
    expect(added.out).toContain('names flagged: Scorely (brand)');

    const row = requireReference(t.db, 'score-fan-out');
    expect(row.status).toBe('ready');
    expect(listReferenceBacklog(t.db, row.id).map((b) => b.name)).toEqual(['scoreboard_flip']);
  });

  it('reports a failed analysis with exit code 1', async () => {
    const bad = { ...seedRecord('live-score-fanout'), arc: 'Open the app for 5 minutes' };
    const file = join(dir, 'breakdown.md');
    writeFileSync(file, seedBreakdown('live-score-fanout'));
    const run = await cli(['references', 'add', file, '--dry-run', dryRunWith(bad, bad, bad)]);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/failed: reference output is still invalid/);
  });

  it('edits a record from a file, refusing one that fails its checks', async () => {
    const record = seedRecord('seat-booking-contention');
    const good = join(dir, 'good.json');
    writeFileSync(good, JSON.stringify({ ...record, title: 'One seat, many buyers' }));
    expect((await cli(['references', 'edit', 'seat-booking-contention', good])).code).toBe(0);
    const row = requireReference(t.db, 'seat-booking-contention');
    expect(readReferenceRecord(t.dataDir, row)?.title).toBe('One seat, many buyers');

    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ ...record, title: 'Seats sold on Ticketo' }));
    const refused = await cli(['references', 'edit', 'seat-booking-contention', bad]);
    expect(refused.code).toBe(1);
    expect(refused.io.errors.join('\n')).toMatch(/\$\.title: proper_noun/);

    const noTerminal = await cli(['references', 'edit', 'seat-booking-contention']);
    expect(noTerminal.code).toBe(1);
  });

  it('analyses a reference again', async () => {
    const record = seedRecord('food-delivery-eta');
    const run = await cli([
      'references',
      'reanalyze',
      'food-delivery-eta',
      '--dry-run',
      dryRunWith(record),
    ]);
    expect(run.code).toBe(0);
    expect(run.out).toContain('reads food-delivery-eta again');
    expect(requireReference(t.db, 'food-delivery-eta').status).toBe('ready');
  });
});

describe('studio references pick', () => {
  it('scores every reference for a topic and marks the picks', async () => {
    const run = await cli([
      'references',
      'pick',
      '--topic',
      'Rate limiters',
      '--series',
      'system-design',
    ]);
    expect(run.code).toBe(0);
    expect(run.io.lines[0]).toBe('Expected class: concept (from the title)');
    expect(run.out).toMatch(
      /✓\s+6\.5\s+database-failover-split-brain: secondary class concept \+1\.5/,
    );
    expect(run.io.lines.filter((l) => l.includes('✓'))).toHaveLength(3);
    expect(run.io.lines.at(-1)).toMatch(/^Shown to the Director: database-failover-split-brain, /);
  });

  it('needs a run or a topic with its series', () => {
    expect(() => parseCommand(['references', 'pick', '--topic', 'x'])).toThrow(UsageError);
    expect(parseCommand(['references', 'pick', '--run', '3'])).toEqual({
      kind: 'references',
      action: 'pick',
      from: { runId: 3 },
    });
  });
});

describe('parsing', () => {
  it('reads --avoid as a brand unless a kind is given', () => {
    expect(avoidName('Scorely')).toEqual({ text: 'Scorely', kind: 'brand' });
    expect(avoidName('title: Who wins?')).toEqual({ text: 'Who wins?', kind: 'title' });
    expect(avoidName('Note: odd')).toEqual({ text: 'Note: odd', kind: 'brand' });
    expect(() => avoidName('title:')).toThrow(UsageError);
  });

  it('parses each references command', () => {
    expect(parseCommand(['references'])).toEqual({ kind: 'references', action: 'list' });
    expect(parseCommand(['references', 'add', '-', '--attach', 'a.png'])).toEqual({
      kind: 'references',
      action: 'add',
      file: '-',
      avoid: [],
      attach: ['a.png'],
    });
    expect(parseCommand(['references', 'edit', 'x', 'r.json'])).toEqual({
      kind: 'references',
      action: 'edit',
      ref: 'x',
      file: 'r.json',
    });
    expect(() => parseCommand(['references', 'show'])).toThrow(UsageError);
    expect(() => parseCommand(['references', 'delete', 'x'])).toThrow(/Unknown references/);
  });
});
