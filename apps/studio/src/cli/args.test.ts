import { describe, expect, it } from 'vitest';
import { DEFAULT_USAGE_VIDEOS } from '@explainer-studio/shared';
import { parseCommand, textSource, UsageError } from './args.ts';
import { runSettings } from './commands/run.ts';
import { FIELDS_PROMPT, parseFieldsAnswer, parseGateReply } from './gate-reply.ts';
import type { CliContext } from './context.ts';
import { regenerateRunsLine, withFields } from './session.ts';
import { fakeIo } from './testing.ts';

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
      '--disagreements',
      'all',
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
      disagreements: 'all',
      auto: true,
      autoFinal: false,
      dryRun: 'rec',
    });
    expect(runSettings(cmd as Extract<typeof cmd, { kind: 'run' }>)).toEqual({
      autoApprove: { research: true, beat_sheet: true, scenes: true, draft: false },
      lengthOverrideSec: 75,
      format: 'card',
      budget: { maxRunUsd: 0.5 },
      research: { disagreementBlocks: 'all' },
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
      ['run', 'X', '--series', 'ai', '--source', 'a.md', '--disagreements', 'some'],
      /--disagreements takes one of: numbers, all, none/,
    );
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

  it('a beat regenerate without --fields changes what the feedback is about', () => {
    const fieldsOf = (feedback: string, ...more: string[]) => {
      const args = ['gate', '4', 'regenerate', '--beat', 'b3', '--feedback', feedback, ...more];
      const command = parseCommand(args);
      return command.kind === 'gate' && command.decision.action === 'regenerate'
        ? command.decision.fields
        : undefined;
    };
    expect(fieldsOf('give the stat card the focus')).toEqual(['board']);
    expect(fieldsOf("don't say it locks")).toEqual(['narration']);
    expect(fieldsOf('give the stat card the focus', '--fields', 'narration')).toEqual([
      'narration',
    ]);
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
    expect(parseCommand(['gate', '2', 'reject', '--notes', 'n', '--propose-rule'])).toEqual({
      kind: 'gate',
      runId: 2,
      decision: { action: 'reject', notes: 'n', proposeRule: true },
    });
    expect(parseCommand(['gate', '2', 'edit', 'p.json', '--notes', 'why'])).toMatchObject({
      decision: { action: 'edit', file: 'p.json', notes: 'why' },
    });
    expect(parseCommand(['usage'])).toEqual({ kind: 'usage', videos: DEFAULT_USAGE_VIDEOS });
    expect(parseCommand(['usage', '--videos', '3'])).toEqual({ kind: 'usage', videos: 3 });
    expect(() => parseCommand(['usage', '--videos', '2.5'])).toThrow(/whole number/);
    expect(() => parseCommand(['usage', '--videos', '999'])).toThrow(/whole number/);
    expect(() => parseCommand(['usage', '3'])).toThrow(/usage \[--videos <n>\]/);
    expect(parseCommand(['render', 'spec.json', '--final'])).toEqual({
      kind: 'render',
      file: 'spec.json',
      final: true,
      series: 'system-design',
    });
    expect(parseCommand([])).toEqual({ kind: 'help' });
  });
});

describe('rules', () => {
  it('reads every rules command', () => {
    expect(parseCommand(['rules'])).toEqual({ kind: 'rules', action: 'list' });
    expect(parseCommand(['rules', '--status', 'proposed', '--scope', 'all'])).toEqual({
      kind: 'rules',
      action: 'list',
      status: 'proposed',
      scope: 'all',
    });
    expect(parseCommand(['rules', 'add', '--scope', 'curator', ' Do not flag it. '])).toEqual({
      kind: 'rules',
      action: 'add',
      scope: 'curator',
      text: 'Do not flag it.',
    });
    expect(parseCommand(['rules', 'accept', '4', '--text', 'Edited.'])).toEqual({
      kind: 'rules',
      action: 'update',
      id: 4,
      change: 'accept',
      text: 'Edited.',
    });
    expect(parseCommand(['rules', 'off', '4'])).toMatchObject({ change: 'deactivate' });
    expect(parseCommand(['rules', 'on', '4'])).toMatchObject({ change: 'activate' });
    expect(parseCommand(['rules', 'edit', '4', '--scope', 'all'])).toEqual({
      kind: 'rules',
      action: 'update',
      id: 4,
      scope: 'all',
    });
    expect(parseCommand(['rules', 'rm', '4'])).toEqual({ kind: 'rules', action: 'delete', id: 4 });
    expect(parseCommand(['rules', 'propose', '--event', '9'])).toEqual({
      kind: 'rules',
      action: 'propose',
      from: { eventId: 9 },
    });
    expect(parseCommand(['rules', 'propose', '--run', '3', '--gate', 'scenes'])).toEqual({
      kind: 'rules',
      action: 'propose',
      from: { runId: 3, gate: 'scenes' },
    });
  });

  it('refuses what it cannot do', () => {
    const fails = (argv: string[], message: RegExp) =>
      expect(() => parseCommand(argv)).toThrow(message);
    fails(['rules', 'add', 'no scope'], /rules add --scope/);
    fails(['rules', 'add', '--scope', 'all', 'x'.repeat(161)], /one line of 1 to 160/);
    fails(['rules', 'edit', '4'], /rules edit <id>/);
    fails(['rules', 'accept'], /rules accept <id>/);
    fails(['rules', 'propose', '--run', '3'], /--event <id> \| --run <id> --gate/);
    fails(['rules', 'frob'], /Unknown rules command/);
    fails(['rules', '--scope', 'researcher'], /--scope takes one of/);
  });
});

describe('parseGateReply', () => {
  it('reads each answer by gate', () => {
    expect(parseGateReply('a', 'research')).toEqual({
      kind: 'decide',
      decision: { action: 'approve' },
    });
    expect(parseGateReply('a "fine, but shorter"', 'research')).toEqual({
      kind: 'decide',
      decision: { action: 'approve', notes: 'fine, but shorter' },
    });
    expect(parseGateReply('e "the hook was vague"', 'beat_sheet')).toEqual({
      kind: 'edit',
      notes: 'the hook was vague',
    });
    expect(parseGateReply('e', 'beat_sheet')).toEqual({ kind: 'edit' });
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
    // Without fields the session asks which part to change (`withFields`).
    expect(parseGateReply('r b3 "pin the tag to the cache card"', 'scenes')).toEqual({
      kind: 'decide',
      decision: {
        action: 'regenerate',
        target: 'beat',
        beatId: 'b3',
        feedback: 'pin the tag to the cache card',
      },
    });
    expect(parseGateReply('r b3', 'scenes').kind).toBe('invalid');
    expect(parseGateReply('r b3:plan fix it', 'scenes').kind).toBe('invalid');
  });
});

describe('parseFieldsAnswer', () => {
  it('takes n, b, o or the words, and Enter for the suggestion', () => {
    expect(FIELDS_PROMPT('board')).toBe('Change [n]arration, [b]oard or b[o]th? [board] ');
    expect(parseFieldsAnswer('', 'board')).toEqual(['board']);
    expect(parseFieldsAnswer(' N ', 'board')).toEqual(['narration']);
    expect(parseFieldsAnswer('o', 'narration')).toEqual(['narration', 'board']);
    expect(parseFieldsAnswer('both', 'board')).toEqual(['narration', 'board']);
    expect(parseFieldsAnswer('maybe', 'board')).toBeUndefined();
  });
});

describe('regenerateRunsLine', () => {
  it('names the agents a beat regenerate calls, in order', () => {
    expect(regenerateRunsLine('b2', ['board'])).toBe(
      'Regenerating b2 (board): runs the Generator, then a Curator review of the beat.',
    );
    expect(regenerateRunsLine('b1', ['narration', 'board'])).toBe(
      'Regenerating b1 (narration, board): runs the Scriptwriter, then the Generator, then a ' +
        'Curator review of the beat.',
    );
  });
});

describe('withFields', () => {
  const regenerate = (feedback: string, fields?: ('narration' | 'board')[]) => ({
    action: 'regenerate' as const,
    target: 'beat' as const,
    beatId: 'b2',
    feedback,
    ...(fields ? { fields } : {}),
  });
  const ctxOf = (io: ReturnType<typeof fakeIo>) => ({ io }) as unknown as CliContext;

  it('asks which part to change, suggesting what the note is about', async () => {
    const io = fakeIo(['maybe', '']);
    const action = await withFields(ctxOf(io), regenerate('give the stat card the focus'));
    expect(action).toMatchObject({ fields: ['board'] });
    expect(io.transcript.filter((l) => l.startsWith('Change '))).toEqual([
      'Change [n]arration, [b]oard or b[o]th? [board] ',
      'Change [n]arration, [b]oard or b[o]th? [board] ',
    ]);
    expect(io.errors).toHaveLength(1);
  });

  it('takes an answer over the suggestion, and never asks when fields are given', async () => {
    const io = fakeIo(['o']);
    expect(await withFields(ctxOf(io), regenerate('give the card focus'))).toMatchObject({
      fields: ['narration', 'board'],
    });
    const given = fakeIo([]);
    expect(await withFields(ctxOf(given), regenerate('x', ['narration']))).toMatchObject({
      fields: ['narration'],
    });
    expect(given.transcript).toEqual([]);
  });

  it('null when the input ends', async () => {
    expect(await withFields(ctxOf(fakeIo([])), regenerate('focus'))).toBeNull();
  });
});
