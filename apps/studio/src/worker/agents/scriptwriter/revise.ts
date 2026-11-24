import {
  ScriptwriterOutputSchema,
  toJsonPath,
  type BeatScript,
  type FixField,
  type MeasuredBeat,
  type ScriptwriterOutput,
} from '@explainer-studio/shared';
import type { OutputIssue } from '#worker/llm/types.ts';
import { scriptwriterCheck, type ScriptwriterCheckDeps } from './check.ts';
import { scriptwriterUserMessage, type ScriptwriterMessage } from './input.ts';

/**
 * The Scriptwriter in beat mode (P1C.8 repairs): the same system prompt as the script job (so
 * its prefix caches), the same run input with the whole current script, then REVISE beat X and
 * a FEEDBACK section (the issues with their quotes, the fields it may change, the beat's word
 * budget and its measured length). The answer is the script schema with one beat. Its check
 * splices that beat into the script and runs every Scriptwriter check on it (keeping only that
 * beat's issues), plus `repair_scope`: a field the request does not allow must stay exactly as
 * it was.
 */

export interface RepairIssue {
  readonly code: string;
  readonly message: string;
  readonly quotes?: readonly string[];
}

export interface ReviseRequest {
  readonly beatId: string;
  /** The Scriptwriter's fields the fix may change. */
  readonly fields: readonly FixField[];
  readonly issues: readonly RepairIssue[];
}

/** The beat's fields, as a fix field names them (FIX_FIELDS that are the Scriptwriter's). */
type ScriptField = 'narration' | 'headline' | 'tags' | 'statCards' | 'source';

const FIELD_KEYS: Readonly<Partial<Record<FixField, ScriptField>>> = {
  narration: 'narration',
  headline: 'headline',
  tags: 'tags',
  stat_cards: 'statCards',
  source: 'source',
};

/** Every field a revision compares; the formula card and command bubble are never in scope. */
const COMPARED = [
  'narration',
  'headline',
  'tags',
  'statCards',
  'source',
  'formulaCard',
  'commandBubble',
] as const;
type Compared = (typeof COMPARED)[number];

const allowedKeys = (req: ReviseRequest): Set<Compared> =>
  new Set(req.fields.flatMap((f) => (FIELD_KEYS[f] ? [FIELD_KEYS[f]] : [])));

export function reviseUserMessage(
  base: ScriptwriterMessage,
  script: readonly BeatScript[],
  req: ReviseRequest,
  measured: MeasuredBeat | undefined,
): string {
  const current = script.find((s) => s.beatId === req.beatId);
  const budget = base.budgets.find((b) => b.beatId === req.beatId);
  const words = current ? current.narration.trim().split(/\s+/).length : 0;
  const allowed = [...allowedKeys(req)];
  const lengthLine = measured
    ? ` It now has ${words} words and runs ${measured.spanSec.toFixed(1)} s against its planned ${measured.targetSec} s.`
    : ` It now has ${words} words.`;
  const budgetLine = budget
    ? `Word budget: about ${budget.words} words (${budget.min} to ${budget.max}).${lengthLine}`
    : lengthLine.trim();
  const feedback = req.issues.map((i) => {
    const quotes = i.quotes?.length ? ` (quoting ${i.quotes.map((q) => `"${q}"`).join(', ')})` : '';
    return `- [${i.code}] ${i.message}${quotes}`;
  });
  return [
    scriptwriterUserMessage(base, {
      intro:
        `Revise beat "${req.beatId}" of this script to fix the issues under FEEDBACK. The ` +
        'research notes below are the only facts.',
    }),
    `## CURRENT SCRIPT\n${JSON.stringify({ script }, null, 2)}`,
    `## REVISE beat ${req.beatId}\nReturn {"script": [<beat ${req.beatId} only, every field>]}. ` +
      `Change only ${allowed.join(', ')}; keep every other field exactly as it is now. ` +
      budgetLine,
    `## FEEDBACK (fix only these)\n${feedback.join('\n')}`,
  ].join('\n\n');
}

/** The revised beat spliced into the script: allowed fields from the answer, the rest kept. */
export function spliceRevision(
  script: readonly BeatScript[],
  req: ReviseRequest,
  revised: ScriptwriterOutput['script'][number],
): BeatScript[] {
  const allowed = allowedKeys(req);
  return script.map((beat) => {
    if (beat.beatId !== req.beatId) return beat;
    const next: BeatScript = { ...beat };
    if (allowed.has('narration')) next.narration = revised.narration;
    if (allowed.has('tags')) next.tags = revised.tags;
    if (allowed.has('statCards')) next.statCards = revised.statCards;
    if (allowed.has('source')) {
      if (revised.source) next.source = revised.source;
      else delete next.source;
    }
    if (allowed.has('headline')) {
      if (revised.headline) {
        next.headline = {
          ...revised.headline,
          ...(beat.headline?.at ? { at: beat.headline.at } : {}),
        };
      } else delete next.headline;
    }
    return next;
  });
}

/** The answer's check: the one beat, every Scriptwriter check on it, and its scope. */
export function reviseCheck(
  deps: ScriptwriterCheckDeps,
  script: readonly BeatScript[],
  req: ReviseRequest,
): (value: unknown) => OutputIssue[] {
  const k = script.findIndex((s) => s.beatId === req.beatId);
  return (value) => {
    const parsed = ScriptwriterOutputSchema.safeParse(value);
    if (!parsed.success) return [];
    const beats = parsed.data.script;
    const revised = beats.find((b) => b.beatId === req.beatId);
    if (beats.length !== 1 || !revised) {
      return [
        {
          path: '$.script',
          code: 'revise_one_beat',
          message: `Return exactly one beat, "${req.beatId}", with every field.`,
        },
      ];
    }
    const full = script.map((b) => (b.beatId === req.beatId ? revised : b));
    const prefix = toJsonPath(['script', k]);
    const issues = scriptwriterCheck(deps)({ script: full })
      .filter(
        (i) =>
          i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`),
      )
      .map((i) => ({ ...i, path: `$.script[0]${i.path.slice(prefix.length)}` }));
    return [...issues, ...scopeIssues(script[k], revised, req)];
  };
}

/** `repair_scope`: each field outside the request is as it was. */
function scopeIssues(
  before: BeatScript | undefined,
  after: ScriptwriterOutput['script'][number],
  req: ReviseRequest,
): OutputIssue[] {
  if (!before) return [];
  const allowed = allowedKeys(req);
  return COMPARED.flatMap((field) => {
    if (allowed.has(field) || same(comparable(before, field), comparable(after, field))) return [];
    return [
      {
        path: `$.script[0].${field}`,
        code: 'repair_scope',
        message:
          `This fix may change only ${[...allowed].join(', ')}; keep ${field} exactly as it was: ` +
          `${JSON.stringify(comparable(before, field))}.`,
      },
    ];
  });
}

function comparable(beat: Partial<BeatScript>, field: Compared): unknown {
  const value = beat[field];
  if (field === 'headline' && value && typeof value === 'object') {
    const { text, semantic } = value as { text: string; semantic: string };
    return { text, semantic };
  }
  if (Array.isArray(value)) return value;
  return value ?? null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
