import { toJsonPath, type NormalizerFix } from '@explainer-studio/shared';
import type { z } from 'zod';

/**
 * The deterministic normalizer. It runs on every LLM output and on pasted external JSON, before
 * validation, and applies only this fixed list of fixes, each logged:
 * 1. strip code fences (```json … ```) and prose around the JSON;
 * 2. rename declared field aliases (only when the canonical field is absent);
 * 3. turn a numeric string into a number where the schema expects a number.
 * It never guesses or invents a value: anything else is left for validation to report.
 */

/**
 * A declared alias: inside every object matched by `at`, `from` is renamed to `to`. `at` is a
 * JSON path of `.key` and `[*]` (every array item) steps from `$`, e.g. `$.script[*]`.
 */
export interface FieldAlias {
  readonly at: string;
  readonly from: string;
  readonly to: string;
}

export interface NormalizeOptions {
  readonly aliases?: readonly FieldAlias[];
  /** Locates numeric strings: only where this schema expects a number. */
  readonly schema?: z.ZodType;
}

export type NormalizeResult =
  | { readonly ok: true; readonly value: unknown; readonly fixes: NormalizerFix[] }
  | { readonly ok: false; readonly error: string; readonly fixes: NormalizerFix[] };

/** Text in, parsed and fixed JSON out (or why no JSON could be read). */
export function normalizeJsonText(text: string, options: NormalizeOptions = {}): NormalizeResult {
  const extracted = extractJson(text);
  if (!extracted.ok) return extracted;
  const fixes = [...extracted.fixes, ...normalizeValue(extracted.value, options)];
  return { ok: true, value: extracted.value, fixes };
}

/** Applies alias and numeric fixes in place to a parsed value; returns the fixes made. */
export function normalizeValue(value: unknown, options: NormalizeOptions = {}): NormalizerFix[] {
  const fixes: NormalizerFix[] = [];
  for (const alias of options.aliases ?? []) fixes.push(...applyAlias(value, alias));
  if (options.schema) fixes.push(...fixNumericStrings(value, options.schema));
  return fixes;
}

// ---------------------------------------------------------------------------------------------
// 1. Fences and prose

type Extracted =
  | { ok: true; value: unknown; fixes: NormalizerFix[] }
  | { ok: false; error: string; fixes: NormalizerFix[] };

const FENCE = /```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/;

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function extractJson(text: string): Extracted {
  const whole = tryParse(text.trim());
  if (whole.ok) return { ok: true, value: whole.value, fixes: [] };

  const fixes: NormalizerFix[] = [];
  let body = text;
  const fence = FENCE.exec(text);
  if (fence) {
    fixes.push({ kind: 'strip_fences', message: 'Removed a Markdown code fence around the JSON' });
    const outside = text.slice(0, fence.index) + text.slice(fence.index + fence[0].length);
    if (outside.trim() !== '') fixes.push(proseFix());
    body = fence[1] ?? '';
    const inner = tryParse(body.trim());
    if (inner.ok) return { ok: true, value: inner.value, fixes };
  }

  const span = balancedSpan(body);
  if (!span) return { ok: false, error: 'No JSON object found in the response', fixes };
  const parsed = tryParse(body.slice(span.start, span.end));
  if (!parsed.ok) return { ok: false, error: 'The JSON in the response does not parse', fixes };
  const around = body.slice(0, span.start) + body.slice(span.end);
  if (around.trim() !== '' && !fixes.some((f) => f.kind === 'strip_prose')) fixes.push(proseFix());
  return { ok: true, value: parsed.value, fixes };
}

function proseFix(): NormalizerFix {
  return { kind: 'strip_prose', message: 'Removed text before or after the JSON' };
}

/** The first top-level `{…}` or `[…]`, matching brackets outside strings. */
function balancedSpan(text: string): { start: number; end: number } | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 2. Aliases

type Step = { kind: 'key'; key: string } | { kind: 'each' };
type Located = { node: unknown; path: PropertyKey[] };

const STEP = /\.([A-Za-z_$][\w$-]*)|\[\*\]/y;

/** Parses an alias path; a malformed one is a programming error, so it throws. */
export function parseAliasPath(at: string): Step[] {
  if (!at.startsWith('$')) throw new Error(`Alias path must start with "$": ${at}`);
  const steps: Step[] = [];
  STEP.lastIndex = 1;
  while (STEP.lastIndex < at.length) {
    const match = STEP.exec(at);
    if (!match) throw new Error(`Invalid alias path: ${at}`);
    steps.push(match[1] === undefined ? { kind: 'each' } : { kind: 'key', key: match[1] });
  }
  return steps;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function locate(root: unknown, steps: readonly Step[]): Located[] {
  let current: Located[] = [{ node: root, path: [] }];
  for (const step of steps) {
    current = current.flatMap(({ node, path }) => {
      if (step.kind === 'each') {
        if (!Array.isArray(node)) return [];
        return (node as unknown[]).map((item, i) => ({ node: item, path: [...path, i] }));
      }
      return isPlainObject(node) && Object.hasOwn(node, step.key)
        ? [{ node: node[step.key], path: [...path, step.key] }]
        : [];
    });
  }
  return current;
}

/** Renames the key in place, keeping key order. */
function renameKey(object: Record<string, unknown>, from: string, to: string): void {
  const entries = Object.entries(object);
  for (const [key] of entries) delete object[key];
  for (const [key, value] of entries) object[key === from ? to : key] = value;
}

function applyAlias(root: unknown, alias: FieldAlias): NormalizerFix[] {
  return locate(root, parseAliasPath(alias.at)).flatMap(({ node, path }) => {
    if (!isPlainObject(node) || !Object.hasOwn(node, alias.from) || Object.hasOwn(node, alias.to)) {
      return [];
    }
    renameKey(node, alias.from, alias.to);
    return [
      {
        kind: 'alias' as const,
        path: toJsonPath([...path, alias.to]),
        message: `Renamed "${alias.from}" to "${alias.to}"`,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Numeric strings

/** A plain decimal number, nothing around it ("12", "-0.5"); no units, separators or exponents. */
const NUMERIC_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function containerAt(root: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null
        ? (node as Record<PropertyKey, unknown>)[key]
        : undefined,
    root,
  );
}

/**
 * Converts strings only at paths where the schema reports "expected number". Union branches are
 * not entered: choosing a branch would be a guess.
 */
function fixNumericStrings(root: unknown, schema: z.ZodType): NormalizerFix[] {
  const result = schema.safeParse(root);
  if (result.success) return [];
  return result.error.issues.flatMap((issue) => {
    if (issue.code !== 'invalid_type' || issue.expected !== 'number') return [];
    const key = issue.path.at(-1);
    if (key === undefined) return [];
    const parent = containerAt(root, issue.path.slice(0, -1));
    if (typeof parent !== 'object' || parent === null) return [];
    const record = parent as Record<PropertyKey, unknown>;
    const current = record[key];
    if (typeof current !== 'string' || !NUMERIC_STRING.test(current)) return [];
    record[key] = Number(current);
    return [
      {
        kind: 'numeric_string' as const,
        path: toJsonPath(issue.path),
        message: `Converted "${current}" to a number`,
      },
    ];
  });
}
