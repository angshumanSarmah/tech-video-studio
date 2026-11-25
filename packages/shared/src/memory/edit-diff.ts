import { toJsonPath } from '../spec/validate.ts';

/**
 * What a person changed in an edit at a gate (P1C.10), for the Analyst: every leaf (string,
 * number, boolean, null) that differs, added or removed, by JSON path, in document order.
 * Capped so a large edit stays a short message. Pure.
 */

export interface LeafChange {
  readonly path: string;
  /** The value before, as JSON text; absent when the leaf is new. */
  readonly before?: string;
  /** The value after, as JSON text; absent when the leaf was removed. */
  readonly after?: string;
}

export interface EditDiff {
  readonly changes: LeafChange[];
  /** Changed leaves left out past the caps. */
  readonly omitted: number;
}

export interface EditDiffOptions {
  /** Changes listed at most. */
  readonly maxChanges?: number;
  /** Characters of all listed values together, at most. */
  readonly maxChars?: number;
  /** Characters of one value shown, at most (longer ones end in "…"). */
  readonly maxValueChars?: number;
}

const DEFAULTS = { maxChanges: 20, maxChars: 3_000, maxValueChars: 200 } as const;

export function editDiff(before: unknown, after: unknown, options: EditDiffOptions = {}): EditDiff {
  const { maxChanges, maxChars, maxValueChars } = { ...DEFAULTS, ...options };
  const all: LeafChange[] = [];
  collect(before, after, [], all, maxValueChars);
  const changes: LeafChange[] = [];
  let chars = 0;
  for (const change of all) {
    const size = (change.before?.length ?? 0) + (change.after?.length ?? 0);
    if (changes.length >= maxChanges || chars + size > maxChars) break;
    changes.push(change);
    chars += size;
  }
  return { changes, omitted: all.length - changes.length };
}

type Path = (string | number)[];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function collect(
  before: unknown,
  after: unknown,
  path: Path,
  out: LeafChange[],
  maxValueChars: number,
): void {
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i += 1) {
      collect(before[i], after[i], [...path, i], out, maxValueChars);
    }
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) collect(before[key], after[key], [...path, key], out, maxValueChars);
    return;
  }
  if (before === undefined && after === undefined) return;
  if (
    before !== undefined &&
    after !== undefined &&
    JSON.stringify(before) === JSON.stringify(after)
  ) {
    return;
  }
  // A subtree added, removed or changed in kind: each of its leaves is one change.
  if (before !== undefined && (isObject(before) || Array.isArray(before)) && after === undefined) {
    collect(before, emptyLike(before), path, out, maxValueChars);
    return;
  }
  if (after !== undefined && (isObject(after) || Array.isArray(after)) && before === undefined) {
    collect(emptyLike(after), after, path, out, maxValueChars);
    return;
  }
  out.push({
    path: toJsonPath(path),
    ...(before === undefined ? {} : { before: shown(before, maxValueChars) }),
    ...(after === undefined ? {} : { after: shown(after, maxValueChars) }),
  });
}

/** An empty object or array of the same kind, so a whole new subtree lists its leaves. */
function emptyLike(value: unknown): unknown {
  return Array.isArray(value) ? [] : {};
}

function shown(value: unknown, max: number): string {
  const text = JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
