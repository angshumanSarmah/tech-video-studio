import { describe, expect, it } from 'vitest';
import { parseCommand, textSource, UsageError } from './args.ts';
import { runSettings } from './commands/run.ts';
import { parseGateReply } from './gate-reply.ts';

describe('parseCommand', () => {
  it('reads a run with every flag', () => {
    const cmd = parseCommand([
      'run',
      ' Consistent hashing ',
      '--series',
      'system-design',
      '--source',
      'https://docs.example.com/ring',
      '--source',
      'notes/ring.pdf',
      '--text',
      'Our = numbers=-',
      '--angle',
      'Why a ring',
      '--level',
      'expert',
      '--length',
      '75',
      '--format',
      'card',
      '--cap',
      '0.5',
      '--words-per-sec',
      '2.7',
      '--auto',
      '--dry-run',
      'rec',
    ]);
    expect(cmd).toEqual({
      kind: 'run',
      topic: 'Consistent hashing',
      series: 'system-design',
      sources: ['https://docs.example.com/ring', 'notes/ring.pdf'],
      texts: [{ title: 'Our = numbers', path: '-' }],
      angle: 'Why a ring',
      level: 'expert',
      lengthSec: 75,
      format: 'card',
      capUsd: 0.5,
      wordsPerSec: 2.7,
      auto: true,
      autoFinal: false,
      dryRun: 'rec',
    });
    expect(runSettings(cmd as Extract<typeof cmd, { kind: 'run' }>)).toEqual({
      autoApprove: { research: true, beat_sheet: true, scenes: true, draft: false },
      lengthOverrideSec: 75,
      format: 'card',
      budget: { maxRunUsd: 0.5 },
      video: { explanationLevel: 'expert', wordsPerSec: 2.7 },
    });
  });

  it('refuses what it cannot run, saying why', () => {
    const fails = (argv: string[], message: RegExp | typeof UsageError) =>
      expect(() => parseCommand(argv)).toThrow(message);
    fails(['run', 'X', '--series', 'ai'], /at least one --source or --text/);
    fails(
      ['run', 'X', '--series', 'web', '--source', 'a.md'],
      /--series takes one of: ai, system-design/,
    );
    fails(['run', '--series', 'ai', '--source', 'a.md'], /quote the topic/);
    fails(
      ['run', 'X', '--series', 'ai', '--source', 'a.md', '--length', 'long'],
      /positive number/,
    );
    fails(['run', 'X', '--series', 'ai', '--source', 'a.md', '--frobnicate'], UsageError);
    fails(['gate', '3', 'maybe'], /approve\|reject\|edit\|regenerate/);
    fails(['gate', 'x', 'approve'], /Not a run id/);
    fails(['resume', '3', '--from', 'tts'], /--from takes one of: ingest, research/);
    fails(['resume', '3', '--from', 'script', '--only', 'generate'], /not both/);
    fails(['frob'], /Unknown command "frob"/);
    expect(() => textSource('no title')).toThrow(/"<title>=<file>"/);
  });

  it('reads gate decisions, resume, status, cost and render', () => {
    expect(
      parseCommand(['gate', '4', 'regenerate', '--beat', 'b3', '--feedback', 'shorter']),
    ).toEqual({
      kind: 'gate',
      runId: 4,
      decision: {
        action: 'regenerate',
        target: 'beat',
        beatId: 'b3',
        fields: ['narration', 'board'],
        feedback: 'shorter',
      },
    });
    expect(
      parseCommand(['gate', '4', 'regenerate', '--target', 'source', '--source-id', '2']),
    ).toEqual({
      kind: 'gate',
      runId: 4,
      decision: { action: 'regenerate', target: 'source', sourceId: 2 },
    });
    expect(parseCommand(['gate', '4', 'edit', 'plan.json'])).toMatchObject({
      decision: { action: 'edit', file: 'plan.json' },
    });
    expect(parseCommand(['resume', '4', '--only', 'generate'])).toEqual({
      kind: 'resume',
      runId: 4,
      only: 'generate',
    });
    expect(parseCommand(['status'])).toEqual({ kind: 'status' });
    expect(parseCommand(['cost', '9'])).toEqual({ kind: 'cost', runId: 9 });
    expect(parseCommand(['render', 'spec.json', '--final'])).toEqual({
      kind: 'render',
      file: 'spec.json',
      final: true,
      series: 'system-design',
    });
    expect(parseCommand([])).toEqual({ kind: 'help' });
  });
});

describe('parseGateReply', () => {
  it('reads each answer by gate', () => {
    expect(parseGateReply('a', 'research')).toEqual({
      kind: 'decide',
      decision: { action: 'approve' },
    });
    expect(parseGateReply('r "more on the incident"', 'research')).toEqual({
      kind: 'decide',
      decision: { action: 'regenerate', target: 'researcher', feedback: 'more on the incident' },
    });
    expect(parseGateReply('r', 'beat_sheet')).toEqual({
      kind: 'decide',
      decision: { action: 'regenerate', target: 'director' },
    });
    expect(parseGateReply('r b3:board,headline "show the ring first"', 'scenes')).toEqual({
      kind: 'decide',
      decision: {
        action: 'regenerate',
        target: 'beat',
        beatId: 'b3',
        fields: ['board', 'headline'],
        feedback: 'show the ring first',
      },
    });
    expect(parseGateReply('r generator calmer boards', 'draft')).toEqual({
      kind: 'decide',
      decision: { action: 'regenerate', target: 'generator', feedback: 'calmer boards' },
    });
    expect(parseGateReply('x too long', 'draft')).toEqual({
      kind: 'decide',
      decision: { action: 'reject', notes: 'too long' },
    });
    expect(parseGateReply(' e ', 'scenes')).toEqual({ kind: 'edit' });
    expect(parseGateReply('q', 'scenes')).toEqual({ kind: 'quit' });
    expect(parseGateReply('r b3', 'scenes').kind).toBe('invalid');
    expect(parseGateReply('r b3:plan fix it', 'scenes').kind).toBe('invalid');
  });
});
