import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import {
  ASSET_FAMILIES,
  DEFAULT_USAGE_VIDEOS,
  DISAGREEMENT_BLOCKS,
  GATE_IDS,
  MEMORY_RULE_SCOPES,
  MEMORY_RULE_STATUSES,
  RuleTextSchema,
  type GateId,
  type MemoryRuleAction,
  type MemoryRuleScope,
  type MemoryRuleStatus,
  EXPLANATION_LEVELS,
  FIX_FIELDS,
  fieldsForFeedback,
  MAX_USAGE_VIDEOS,
  REGENERATE_TARGETS,
  VIDEO_FORMATS,
  AVOID_NAME_KINDS,
  type AvoidName,
  type AvoidNameKind,
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

/** `proposeRule`: the Analyst proposes a style rule from the decision's text (P1C.10). */
export type GateAction = (
  | { readonly action: 'approve'; readonly notes?: string }
  | { readonly action: 'reject'; readonly notes?: string }
  | { readonly action: 'edit'; readonly file: string; readonly notes?: string }
  | {
      readonly action: 'regenerate';
      readonly target: RegenerateTarget;
      readonly beatId?: string;
      readonly fields?: readonly FixField[];
      readonly sourceId?: number;
      readonly feedback?: string;
    }
) & { readonly proposeRule?: boolean };

/** `studio rules …` (P1C.10): style rules before the UI exists. */
export type RulesCommand = { readonly kind: 'rules' } & (
  | {
      readonly action: 'list';
      readonly status?: MemoryRuleStatus;
      readonly scope?: MemoryRuleScope;
    }
  | { readonly action: 'add'; readonly scope: MemoryRuleScope; readonly text: string }
  | {
      readonly action: 'update';
      readonly id: number;
      readonly change?: MemoryRuleAction;
      readonly text?: string;
      readonly scope?: MemoryRuleScope;
    }
  | { readonly action: 'delete'; readonly id: number }
  | {
      readonly action: 'propose';
      readonly from:
        { readonly eventId: number } | { readonly runId: number; readonly gate: GateId };
      readonly dryRun?: string;
    }
);

/** `studio assets …` (P1C.12): the asset library and its drafts before the UI exists. */
export type AssetsCommand = { readonly kind: 'assets' } & (
  | {
      readonly action: 'list';
      readonly status?: string;
      readonly family?: string;
      readonly q?: string;
    }
  | { readonly action: 'show'; readonly id: string }
  | {
      readonly action: 'add';
      readonly file: string;
      readonly id: string;
      readonly name: string;
      readonly family: string;
      readonly tags: readonly string[];
      readonly aliases: readonly string[];
      readonly description?: string;
      readonly licence?: string;
      readonly source?: string;
    }
  | {
      readonly action: 'draft';
      readonly name: string;
      readonly family: string;
      readonly description: string;
      readonly id?: string;
      readonly dryRun?: string;
    }
  | {
      readonly action: 'approve';
      readonly id: string;
      readonly variant: number;
      readonly tags?: readonly string[];
      readonly aliases?: readonly string[];
      readonly note?: string;
    }
  | { readonly action: 'reject'; readonly id: string; readonly note: string }
  | {
      readonly action: 'regenerate';
      readonly id: string;
      readonly note: string;
      readonly dryRun?: string;
    }
);

/** `studio references …` (P1C.11): the reference library before the UI exists. */
export type ReferencesCommand = { readonly kind: 'references' } & (
  | { readonly action: 'list' }
  | {
      readonly action: 'add';
      /** A breakdown file, or `-` for stdin. */
      readonly file: string;
      readonly title?: string;
      readonly avoid: readonly AvoidName[];
      readonly attach: readonly string[];
      readonly dryRun?: string;
    }
  | { readonly action: 'show'; readonly ref: string; readonly json: boolean }
  | { readonly action: 'edit'; readonly ref: string; readonly file?: string }
  | { readonly action: 'reanalyze'; readonly ref: string; readonly dryRun?: string }
  | {
      readonly action: 'pick';
      readonly from:
        { readonly runId: number } | { readonly topic: string; readonly series: SeriesTag };
    }
);

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
  | { readonly kind: 'usage'; readonly videos: number }
  | RulesCommand
  | ReferencesCommand
  | AssetsCommand
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
  gate <run> approve [--notes <text>] [--propose-rule]
  gate <run> reject [--notes <text>] [--propose-rule]
  gate <run> edit <file.json> [--notes <text>] [--propose-rule]
  gate <run> regenerate (--beat <id> [--fields a,b] | --target <role> [--source-id <n>]) [--feedback <text>] [--propose-rule]
        Decide at the gate the run waits at, then follow it. --fields defaults to what the
        feedback is about (board, narration, or both). --propose-rule: the Analyst proposes a
        style rule from the notes (or feedback); you accept it or not.
  resume <run> [--from <step> | --only <step>] [--cap <usd>] [--dry-run <dir>]
        Follow a run again: a failed run goes on from its failed step, a paused one after --cap.
        --from reruns a step and everything after it; --only reruns one step and stops at the
        gate it feeds. Steps: ${RERUN_STEPS.join(', ')}.
  status [<run>]          Recent runs, or one run with its gates, parts and the worker lock.
  cost <run>              The run's LLM cost per role (a multi-part video: every part).
  rules [--status <s>] [--scope <s>]      Style rules (statuses: ${MEMORY_RULE_STATUSES.join(', ')}).
  rules add --scope <scope> "<text>"      A rule written by hand, active at once.
  rules accept <id> [--text "<t>"] [--scope <s>] · rules reject <id> · rules edit <id> [--text] [--scope]
  rules on <id> · rules off <id> · rules rm <id>
  rules propose (--event <id> | --run <id> --gate <gate>) [--dry-run <dir>]
        The Analyst proposes a style rule from a gate decision's note (--run/--gate: the newest
        note at that gate). Scopes: ${MEMORY_RULE_SCOPES.join(', ')} (all: the three writers).
  references                                The reference library: slug, status, class, devices.
  references add <file|-> [--title <t>] [--avoid [<kind>:]<name>]... [--attach <image>]... [--dry-run <dir>]
        Paste a breakdown (a file, or - for stdin); the Reference analyst turns it into a
        structure-only record. --avoid: a name only code reads (kinds: ${AVOID_NAME_KINDS.join(', ')};
        default brand). Screenshots are kept for you, never sent to a model.
  references show <ref> [--json] · references edit <ref> [<record.json>] · references reanalyze <ref>
        <ref> is a slug or an id. edit opens $EDITOR on the record (or saves the file given).
  references pick (--run <id> | --topic "<title>" --series ai|system-design)
        Which references the Director would be shown, every one scored with its reasons.
  assets [--status draft|approved|rejected] [--family <f>] [--q "<words>"]
        The asset library: id, family, status (drafts: queued, drafting, ready or failed).
  assets show <id>        One asset: a draft's variants, sheet, requests, notes and cost.
  assets add <file.svg> --id <id> --name "<name>" --family <family> [--tags a,b] [--alias <id>]...
      [--description "<what it shows>"] [--licence <spdx>] [--source <where from>]
        Add your own SVG to the asset library, approved: it is sanitized first (anything unsafe
        refused, editor leftovers fixed). Families: ${ASSET_FAMILIES.join(', ')}.
  assets draft "<name>" --family <family> --description "<what it shows>" [--id <id>] [--dry-run <dir>]
        The Asset drafter draws three variants and a preview sheet; nothing is approved for you.
  assets approve <id> --variant <n> [--tags a,b] [--alias <id>]... [--note "<n>"]
  assets reject <id> --note "<why>" · assets regenerate <id> --note "<feedback>" [--dry-run <dir>]
  usage [--videos <n>]    What the last n exported videos used (default ${DEFAULT_USAGE_VIDEOS}): each
                          video's hook, ending and main patterns, then counts per kind.
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
    case 'usage':
      return parseUsage(rest);
    case 'rules':
      return parseRules(rest);
    case 'references':
      return parseReferences(rest);
    case 'assets':
      return parseAssets(rest);
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
    'propose-rule': { type: 'boolean' },
    'dry-run': { type: 'string' },
  });
  const [run, action, file, ...extra] = found;
  const runId = runIdOf(run);
  const dryRun = optional('dryRun', text(values['dry-run']));
  const notes = optional('notes', text(values.notes));
  const propose = values['propose-rule'] === true ? { proposeRule: true } : {};
  const only = (allowed: number) => {
    if (extra.length > 0 || (allowed === 0 && file !== undefined)) {
      throw new UsageError(`Too many arguments for gate ${action ?? ''}.`);
    }
  };
  switch (action) {
    case 'approve':
    case 'reject':
      only(0);
      return { kind: 'gate', runId, decision: { action, ...notes, ...propose }, ...dryRun };
    case 'edit':
      only(1);
      if (!file) throw new UsageError('Expected: gate <run> edit <file.json>');
      return { kind: 'gate', runId, decision: { action, file, ...notes, ...propose }, ...dryRun };
    case 'regenerate':
      only(0);
      return { kind: 'gate', runId, decision: { ...regenerate(values), ...propose }, ...dryRun };
    default:
      throw new UsageError('Expected: gate <run> approve|reject|edit|regenerate');
  }
}

function regenerate(values: Record<string, unknown>): GateAction {
  const beatId = text(values['beat']);
  const feedback = optional('feedback', text(values['feedback']));
  if (beatId !== undefined) {
    if (values['target'] !== undefined) throw new UsageError('Give --beat or --target, not both.');
    const given = text(values['fields']);
    // Without --fields, the note decides: a note about the board calls only the Generator.
    const fields = given
      ? given.split(',').map((f) => oneOf('--fields', f.trim(), FIX_FIELDS, true))
      : fieldsForFeedback(feedback.feedback ?? '');
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

const RULE_CHANGES: Readonly<Record<string, MemoryRuleAction | undefined>> = {
  accept: 'accept',
  reject: 'reject',
  on: 'activate',
  off: 'deactivate',
  edit: undefined,
};

function parseRules(args: readonly string[]): RulesCommand {
  const { values, positionals: found } = parse(args, {
    status: { type: 'string' },
    scope: { type: 'string' },
    text: { type: 'string' },
    event: { type: 'string' },
    run: { type: 'string' },
    gate: { type: 'string' },
    'dry-run': { type: 'string' },
  });
  const [sub = 'list', ...rest] = found;
  const scope = optional('scope', oneOf('--scope', values.scope, MEMORY_RULE_SCOPES));
  const ruleId = () => {
    if (rest.length !== 1) throw new UsageError(`Expected: rules ${sub} <id>`);
    return idOf('rule', rest[0]);
  };
  switch (sub) {
    case 'list':
      if (rest.length > 0) throw new UsageError('Expected: rules [--status <s>] [--scope <s>]');
      return {
        kind: 'rules',
        action: 'list',
        ...optional('status', oneOf('--status', values.status, MEMORY_RULE_STATUSES)),
        ...scope,
      };
    case 'add': {
      if (rest.length !== 1 || !scope.scope) {
        throw new UsageError('Expected: rules add --scope <scope> "<text>"');
      }
      return { kind: 'rules', action: 'add', scope: scope.scope, text: ruleText(rest[0]) };
    }
    case 'accept':
    case 'reject':
    case 'on':
    case 'off':
    case 'edit': {
      const id = ruleId();
      const change = RULE_CHANGES[sub];
      const newText = text(values.text);
      if (sub === 'edit' && newText === undefined && !scope.scope) {
        throw new UsageError('Expected: rules edit <id> [--text "<text>"] [--scope <scope>]');
      }
      return {
        kind: 'rules',
        action: 'update',
        id,
        ...(change ? { change } : {}),
        ...(newText !== undefined ? { text: ruleText(newText) } : {}),
        ...scope,
      };
    }
    case 'rm':
      return { kind: 'rules', action: 'delete', id: ruleId() };
    case 'propose':
      return {
        kind: 'rules',
        action: 'propose',
        from: proposeFrom(values, rest),
        ...optional('dryRun', text(values['dry-run'])),
      };
    default:
      throw new UsageError(
        `Unknown rules command "${sub}": list, add, accept, reject, edit, on, off, rm or propose.`,
      );
  }
}

function proposeFrom(
  values: Record<string, unknown>,
  rest: readonly string[],
): Extract<RulesCommand, { action: 'propose' }>['from'] {
  const form = 'rules propose (--event <id> | --run <id> --gate <gate>)';
  if (rest.length > 0) throw new UsageError(`Expected: ${form}`);
  if (values.event !== undefined) {
    if (values.run !== undefined || values.gate !== undefined)
      throw new UsageError(`Expected: ${form}`);
    return { eventId: idOf('event', text(values.event)) };
  }
  if (values.run === undefined || values.gate === undefined)
    throw new UsageError(`Expected: ${form}`);
  return { runId: runIdOf(text(values.run)), gate: oneOf('--gate', values.gate, GATE_IDS, true) };
}

function parseAssets(args: readonly string[]): AssetsCommand {
  const { values, positionals: found } = parse(args, {
    id: { type: 'string' },
    name: { type: 'string' },
    family: { type: 'string' },
    tags: { type: 'string' },
    alias: { type: 'string', multiple: true },
    description: { type: 'string' },
    licence: { type: 'string' },
    source: { type: 'string' },
    status: { type: 'string' },
    q: { type: 'string' },
    variant: { type: 'string' },
    note: { type: 'string' },
    'dry-run': { type: 'string' },
  });
  const [sub = 'list', ...rest] = found;
  const dryRun = optional('dryRun', text(values['dry-run']));
  const one = (form: string) => {
    if (rest.length !== 1 || !rest[0]) throw new UsageError(`Expected: ${form}`);
    return rest[0];
  };
  const note = (form: string) => {
    const value = text(values.note);
    if (!value) throw new UsageError(`Expected: ${form}`);
    return value;
  };
  switch (sub) {
    case 'list':
      if (rest.length > 0)
        throw new UsageError('Expected: assets [--status <s>] [--family <f>] [--q "<words>"]');
      return {
        kind: 'assets',
        action: 'list',
        ...optional('status', text(values.status)),
        ...optional('family', text(values.family)),
        ...optional('q', text(values.q)),
      };
    case 'show':
      return { kind: 'assets', action: 'show', id: one('assets show <id>') };
    case 'add':
      return parseAssetAdd(values, rest);
    case 'draft': {
      const form =
        'assets draft "<name>" --family <family> --description "<what it shows>" [--id <id>]';
      const name = one(form);
      const family = text(values.family);
      const description = text(values.description);
      if (!family || !description) throw new UsageError(`Expected: ${form}`);
      return {
        kind: 'assets',
        action: 'draft',
        name,
        family,
        description,
        ...optional('id', text(values.id)),
        ...dryRun,
      };
    }
    case 'approve': {
      const form =
        'assets approve <id> --variant <n> [--tags a,b] [--alias <id>]... [--note "<n>"]';
      const id = one(form);
      const variant = Number(text(values.variant));
      if (!Number.isInteger(variant) || variant < 1) throw new UsageError(`Expected: ${form}`);
      const tags = text(values.tags);
      return {
        kind: 'assets',
        action: 'approve',
        id,
        variant,
        ...(tags !== undefined ? { tags: tagList(tags) } : {}),
        ...(values.alias ? { aliases: values.alias as string[] } : {}),
        ...optional('note', text(values.note)),
      };
    }
    case 'reject': {
      const form = 'assets reject <id> --note "<why>"';
      return { kind: 'assets', action: 'reject', id: one(form), note: note(form) };
    }
    case 'regenerate': {
      const form = 'assets regenerate <id> --note "<what to draw instead>"';
      return { kind: 'assets', action: 'regenerate', id: one(form), note: note(form), ...dryRun };
    }
    default:
      throw new UsageError(
        `Unknown assets command "${sub}": list, show, add, draft, approve, reject or regenerate.`,
      );
  }
}

function parseAssetAdd(
  values: Record<string, unknown>,
  rest: readonly string[],
): Extract<AssetsCommand, { action: 'add' }> {
  const [file, ...extra] = rest;
  const form = 'assets add <file.svg> --id <id> --name "<name>" --family <family>';
  const id = text(values.id);
  const name = text(values.name);
  const family = text(values.family);
  if (!file || extra.length > 0 || !id || !name || !family) {
    throw new UsageError(`Expected: ${form}`);
  }
  return {
    kind: 'assets',
    action: 'add',
    file,
    id,
    name,
    family,
    tags: tagList(text(values.tags) ?? ''),
    aliases: (values.alias ?? []) as string[],
    ...optional('description', text(values.description)),
    ...optional('licence', text(values.licence)),
    ...optional('source', text(values.source)),
  };
}

function tagList(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

function parseReferences(args: readonly string[]): ReferencesCommand {
  const { values, positionals: found } = parse(args, {
    title: { type: 'string' },
    avoid: { type: 'string', multiple: true },
    attach: { type: 'string', multiple: true },
    json: { type: 'boolean' },
    run: { type: 'string' },
    topic: { type: 'string' },
    series: { type: 'string' },
    'dry-run': { type: 'string' },
  });
  const [sub = 'list', ...rest] = found;
  const dryRun = optional('dryRun', text(values['dry-run']));
  const one = (form: string) => {
    if (rest.length !== 1 || !rest[0]?.trim()) throw new UsageError(`Expected: references ${form}`);
    return rest[0].trim();
  };
  switch (sub) {
    case 'list':
      if (rest.length > 0) throw new UsageError('Expected: references');
      return { kind: 'references', action: 'list' };
    case 'add':
      return {
        kind: 'references',
        action: 'add',
        file: one('add <file|->'),
        ...optional('title', text(values.title)),
        avoid: ((values.avoid ?? []) as string[]).map(avoidName),
        attach: (values.attach ?? []) as string[],
        ...dryRun,
      };
    case 'show':
      return {
        kind: 'references',
        action: 'show',
        ref: one('show <ref>'),
        json: values.json === true,
      };
    case 'edit': {
      if (rest.length < 1 || rest.length > 2) {
        throw new UsageError('Expected: references edit <ref> [<record.json>]');
      }
      return {
        kind: 'references',
        action: 'edit',
        ref: rest[0]!,
        ...optional('file', text(rest[1])),
      };
    }
    case 'reanalyze':
      return { kind: 'references', action: 'reanalyze', ref: one('reanalyze <ref>'), ...dryRun };
    case 'pick':
      return { kind: 'references', action: 'pick', from: pickFrom(values, rest) };
    default:
      throw new UsageError(
        `Unknown references command "${sub}": list, add, show, edit, reanalyze or pick.`,
      );
  }
}

function pickFrom(
  values: Record<string, unknown>,
  rest: readonly string[],
): Extract<ReferencesCommand, { action: 'pick' }>['from'] {
  const form = 'references pick (--run <id> | --topic "<title>" --series ai|system-design)';
  if (rest.length > 0) throw new UsageError(`Expected: ${form}`);
  if (values['run'] !== undefined) {
    if (values['topic'] !== undefined) throw new UsageError(`Expected: ${form}`);
    return { runId: runIdOf(text(values['run'])) };
  }
  const topic = text(values['topic']);
  if (!topic) throw new UsageError(`Expected: ${form}`);
  return { topic, series: oneOf('--series', values['series'], SERIES_TAGS, true) };
}

/** `--avoid "[<kind>:]<name>"`: a brand unless it starts with a known kind. */
export function avoidName(value: string): AvoidName {
  const at = value.indexOf(':');
  const prefix = at > 0 ? value.slice(0, at).trim() : '';
  const known = (AVOID_NAME_KINDS as readonly string[]).includes(prefix);
  const name = (known ? value.slice(at + 1) : value).trim();
  if (!name || name.length > 60) {
    throw new UsageError(`--avoid takes "[<kind>:]<name>" of 1 to 60 characters, not "${value}".`);
  }
  return { text: name, kind: known ? (prefix as AvoidNameKind) : 'brand' };
}

/** A rule's text from the command line: one line of at most 160 characters. */
function ruleText(value: string | undefined): string {
  const parsed = RuleTextSchema.safeParse(value ?? '');
  if (!parsed.success) {
    throw new UsageError(
      `A rule is one line of 1 to 160 characters: ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data;
}

function idOf(what: string, value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`Not a ${what} id: "${value ?? ''}".`);
  return id;
}

function parseUsage(args: readonly string[]): Command {
  const { values, positionals: found } = parse(args, { videos: { type: 'string' } });
  if (found.length > 0) throw new UsageError('Expected: usage [--videos <n>]');
  const videos = positiveNumber('--videos', values.videos) ?? DEFAULT_USAGE_VIDEOS;
  if (!Number.isInteger(videos) || videos > MAX_USAGE_VIDEOS) {
    throw new UsageError(`--videos takes a whole number from 1 to ${MAX_USAGE_VIDEOS}.`);
  }
  return { kind: 'usage', videos };
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
