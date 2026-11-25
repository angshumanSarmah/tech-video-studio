import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import {
  DISAGREEMENT_BLOCKS,
  EXPLANATION_LEVELS,
  FIX_FIELDS,
  REGENERATE_TARGETS,
  VIDEO_FORMATS,
  type DisagreementBlocks,
  type ExplanationLevel,
  type FixField,
  type RegenerateTarget,
  type VideoFormat,
} from '@explainer-studio/shared';
import { RERUN_STEPS, type RerunStep } from '#core/services/run-control.ts';

/**
 * The studio CLI's commands (P1C.9b), parsed from argv. Pure: no I/O; a bad command is a
 * `UsageError` whose message says what is wrong, then the usage.
 */

export const SERIES_TAGS = ['ai', 'system-design'] as const;
export type SeriesTag = (typeof SERIES_TAGS)[number];

/** `--text "<title>=<file or ->"`: pasted text from a file, or from stdin (`-`). */
export interface TextSource {
  readonly title: string;
  readonly path: string;
}

export interface RunCommand {
  readonly kind: 'run';
  readonly topic: string;
  readonly series: SeriesTag;
  readonly sources: readonly string[];
  readonly texts: readonly TextSource[];
  readonly angle?: string;
  readonly level?: ExplanationLevel;
  readonly lengthSec?: number;
  readonly format?: VideoFormat;
  readonly capUsd?: number;
  readonly wordsPerSec?: number;
  /** Which source disagreements block gate 1 (`research.disagreementBlocks`). */
  readonly disagreements?: DisagreementBlocks;
  /** Gates 1-3 approve themselves when nothing blocks. */
  readonly auto: boolean;
  /** Gate 4 too. */
  readonly autoFinal: boolean;
  readonly dryRun?: string;
}

export type GateAction =
  | { readonly action: 'approve'; readonly notes?: string }
  | { readonly action: 'reject'; readonly notes?: string }
  | { readonly action: 'edit'; readonly file: string }
  | {
      readonly action: 'regenerate';
      readonly target: RegenerateTarget;
      readonly beatId?: string;
      readonly fields?: readonly FixField[];
      readonly sourceId?: number;
      readonly feedback?: string;
    };

export type Command =
  | { readonly kind: 'help' }
  | RunCommand
  | {
      readonly kind: 'gate';
      readonly runId: number;
      readonly decision: GateAction;
      readonly dryRun?: string;
    }
  | {
      readonly kind: 'resume';
      readonly runId: number;
      readonly from?: RerunStep;
      readonly only?: RerunStep;
      readonly capUsd?: number;
      readonly dryRun?: string;
    }
  | { readonly kind: 'status'; readonly runId?: number }
  | { readonly kind: 'cost'; readonly runId: number }
  | {
      readonly kind: 'render';
      readonly file: string;
      readonly final: boolean;
      readonly series: SeriesTag;
      readonly dryRun?: string;
    };

export const USAGE = `Usage: pnpm studio <command> [options]

  run "<topic>" --series ai|system-design [--source <url|file>]... [--text "<title>=<file|->"]...
      [--angle <text>] [--level beginner|intermediate|expert] [--length <sec>] [--format full|card]
      [--cap <usd>] [--words-per-sec <n>] [--disagreements numbers|all|none] [--auto]
      [--auto-final] [--dry-run <dir>]
        Start a run and follow it. --auto approves gates 1-3 when nothing blocks; gate 4 needs
        --auto-final. --disagreements: which source disagreements stop gate 1 (default: those
        involving a number). Files: .md .markdown .txt .pdf .docx .csv .json.
  gate <run> approve [--notes <text>]
  gate <run> reject [--notes <text>]
  gate <run> edit <file.json>
  gate <run> regenerate (--beat <id> [--fields a,b] | --target <role> [--source-id <n>]) [--feedback <text>]
        Decide at the gate the run waits at, then follow it.
  resume <run> [--from <step> | --only <step>] [--cap <usd>] [--dry-run <dir>]
        Follow a run again: a failed run goes on from its failed step, a paused one after --cap.
        --from reruns a step and everything after it; --only reruns one step and stops at the
        gate it feeds. Steps: ${RERUN_STEPS.join(', ')}.
  status [<run>]          Recent runs, or one run with its gates, parts and the worker lock.
  cost <run>              The run's LLM cost per role (a multi-part video: every part).
  render <spec.json> [--draft|--final] [--series ai|system-design] [--dry-run <dir>]
        Render a saved spec (no LLM calls): the draft, or the final as well.

With a terminal, gates show a summary and ask what to do; without one, the CLI stops at a gate
and prints the exact commands.`;

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export function parseCommand(argv: readonly string[]): Command {
  const [name, ...rest] = argv;
  switch (name) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return { kind: 'help' };
    case 'run':
      return parseRun(rest);
    case 'gate':
      return parseGate(rest);
    case 'resume':
      return parseResume(rest);
    case 'status':
      return parseStatus(rest);
    case 'cost':
      return { kind: 'cost', runId: runIdOf(positionals(rest, 1, 'cost <run>')[0]) };
    case 'render':
      return parseRender(rest);
    default:
      throw new UsageError(`Unknown command "${name}".`);
  }
}

function parse(args: readonly string[], options: ParseArgsOptionsConfig) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function positionals(args: readonly string[], count: number, form: string): string[] {
  const { positionals: found } = parse(args, {});
  if (found.length !== count) throw new UsageError(`Expected: ${form}`);
  return found;
}

function parseRun(args: readonly string[]): RunCommand {
  const { values, positionals: found } = parse(args, {
    series: { type: 'string' },
    source: { type: 'string', multiple: true },
    text: { type: 'string', multiple: true },
    angle: { type: 'string' },
    level: { type: 'string' },
    length: { type: 'string' },
    format: { type: 'string' },
    cap: { type: 'string' },
    'words-per-sec': { type: 'string' },
    disagreements: { type: 'string' },
    auto: { type: 'boolean' },
    'auto-final': { type: 'boolean' },
    'dry-run': { type: 'string' },
  });
  const [topic, ...extra] = found;
  if (!topic?.trim() || extra.length > 0) {
    throw new UsageError('Expected: run "<topic>" --series ai|system-design (quote the topic).');
  }
  const sources = (values.source ?? []) as string[];
  const texts = ((values.text ?? []) as string[]).map(textSource);
  if (sources.length + texts.length === 0) {
    throw new UsageError('A run needs at least one --source or --text.');
  }
  return {
    kind: 'run',
    topic: topic.trim(),
    series: oneOf('--series', values.series, SERIES_TAGS, true),
    sources,
    texts,
    ...optional('angle', text(values.angle)),
    ...optional('level', oneOf('--level', values.level, EXPLANATION_LEVELS)),
    ...optional('lengthSec', positiveNumber('--length', values.length)),
    ...optional('format', oneOf('--format', values.format, VIDEO_FORMATS)),
    ...optional('capUsd', positiveNumber('--cap', values.cap)),
    ...optional('wordsPerSec', positiveNumber('--words-per-sec', values['words-per-sec'])),
    ...optional(
      'disagreements',
      oneOf('--disagreements', values.disagreements, DISAGREEMENT_BLOCKS),
    ),
    auto: values.auto === true,
    autoFinal: values['auto-final'] === true,
    ...optional('dryRun', text(values['dry-run'])),
  };
}

/** `"<title>=<file or ->"`: the title is everything before the last `=`. */
export function textSource(value: string): TextSource {
  const at = value.lastIndexOf('=');
  const title = value.slice(0, Math.max(at, 0)).trim();
  const path = value.slice(at + 1).trim();
  if (at < 0 || !title || !path) {
    throw new UsageError(`--text takes "<title>=<file>" or "<title>=-" (stdin), not "${value}".`);
  }
  return { title, path };
}

function parseGate(args: readonly string[]): Command {
  const { values, positionals: found } = parse(args, {
    notes: { type: 'string' },
    beat: { type: 'string' },
    fields: { type: 'string' },
    target: { type: 'string' },
    'source-id': { type: 'string' },
    feedback: { type: 'string' },
    'dry-run': { type: 'string' },
  });
  const [run, action, file, ...extra] = found;
  const runId = runIdOf(run);
  const dryRun = optional('dryRun', text(values['dry-run']));
  const notes = optional('notes', text(values.notes));
  const only = (allowed: number) => {
    if (extra.length > 0 || (allowed === 0 && file !== undefined)) {
      throw new UsageError(`Too many arguments for gate ${action ?? ''}.`);
    }
  };
  switch (action) {
    case 'approve':
    case 'reject':
      only(0);
      return { kind: 'gate', runId, decision: { action, ...notes }, ...dryRun };
    case 'edit':
      only(1);
      if (!file) throw new UsageError('Expected: gate <run> edit <file.json>');
      return { kind: 'gate', runId, decision: { action, file }, ...dryRun };
    case 'regenerate':
      only(0);
      return { kind: 'gate', runId, decision: regenerate(values), ...dryRun };
    default:
      throw new UsageError('Expected: gate <run> approve|reject|edit|regenerate');
  }
}

function regenerate(values: Record<string, unknown>): GateAction {
  const beatId = text(values['beat']);
  const feedback = optional('feedback', text(values['feedback']));
  if (beatId !== undefined) {
    if (values['target'] !== undefined) throw new UsageError('Give --beat or --target, not both.');
    const fields = (text(values['fields']) ?? 'narration,board')
      .split(',')
      .map((f) => oneOf('--fields', f.trim(), FIX_FIELDS, true));
    return { action: 'regenerate', target: 'beat', beatId, fields, ...feedback };
  }
  const target = oneOf('--target', values['target'], REGENERATE_TARGETS, true);
  return {
    action: 'regenerate',
    target,
    ...optional('sourceId', positiveNumber('--source-id', values['source-id'])),
    ...feedback,
  };
}

function parseResume(args: readonly string[]): Command {
  const { values, positionals: found } = parse(args, {
    from: { type: 'string' },
    only: { type: 'string' },
    cap: { type: 'string' },
    'dry-run': { type: 'string' },
  });
  if (found.length !== 1) throw new UsageError('Expected: resume <run> [--from|--only <step>]');
  if (values.from !== undefined && values.only !== undefined) {
    throw new UsageError('Give --from or --only, not both.');
  }
  return {
    kind: 'resume',
    runId: runIdOf(found[0]),
    ...optional('from', oneOf('--from', values.from, RERUN_STEPS)),
    ...optional('only', oneOf('--only', values.only, RERUN_STEPS)),
    ...optional('capUsd', positiveNumber('--cap', values.cap)),
    ...optional('dryRun', text(values['dry-run'])),
  };
}

function parseStatus(args: readonly string[]): Command {
  const { positionals: found } = parse(args, {});
  if (found.length > 1) throw new UsageError('Expected: status [<run>]');
  return found[0] === undefined ? { kind: 'status' } : { kind: 'status', runId: runIdOf(found[0]) };
}

function parseRender(args: readonly string[]): Command {
  const { values, positionals: found } = parse(args, {
    draft: { type: 'boolean' },
    final: { type: 'boolean' },
    series: { type: 'string' },
    'dry-run': { type: 'string' },
  });
  if (found.length !== 1) throw new UsageError('Expected: render <spec.json> [--draft|--final]');
  if (values.draft && values.final) throw new UsageError('Give --draft or --final, not both.');
  return {
    kind: 'render',
    file: found[0]!,
    final: values.final === true,
    series:
      values.series === undefined
        ? 'system-design'
        : oneOf('--series', values.series, SERIES_TAGS, true),
    ...optional('dryRun', text(values['dry-run'])),
  };
}

function runIdOf(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`Not a run id: "${value ?? ''}".`);
  return id;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positiveNumber(flag: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} takes a positive number.`);
  return n;
}

function oneOf<T extends string>(
  flag: string,
  value: unknown,
  allowed: readonly T[],
  required: true,
): T;
function oneOf<T extends string>(
  flag: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined;
function oneOf<T extends string>(
  flag: string,
  value: unknown,
  allowed: readonly T[],
  required = false,
): T | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new UsageError(`${flag} takes one of: ${allowed.join(', ')}.`);
}

/** `{ [key]: value }` when the value is set, else `{}` (exactOptionalPropertyTypes-friendly). */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
