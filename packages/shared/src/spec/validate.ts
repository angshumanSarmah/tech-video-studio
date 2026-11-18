import type { z } from 'zod';
import type { RenderableVideoSpec, VideoSpec } from './shape.ts';
import { RenderableVideoSpecSchema, VideoSpecSchema } from './video-spec.ts';

export interface SpecError {
  /** JSON path, e.g. `$.scenes[2].events[0].at.index`. */
  path: string;
  /** Zod issue code, or a `SpecIssueCode` for cross-reference problems. */
  code: string;
  message: string;
}

export type SpecValidationResult<T> = { ok: true; spec: T } | { ok: false; errors: SpecError[] };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function toJsonPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    const name = String(key);
    return IDENTIFIER.test(name) ? `${acc}.${name}` : `${acc}[${JSON.stringify(name)}]`;
  }, '$');
}

function toSpecError(issue: z.core.$ZodIssue): SpecError {
  const params =
    issue.code === 'custom' ? (issue.params as { code?: unknown } | undefined) : undefined;
  const code = typeof params?.code === 'string' ? params.code : issue.code;
  return { path: toJsonPath(issue.path), code, message: issue.message };
}

function toResult<T>(parsed: z.ZodSafeParseResult<T>): SpecValidationResult<T> {
  return parsed.success
    ? { ok: true, spec: parsed.data }
    : { ok: false, errors: parsed.error.issues.map(toSpecError) };
}

/** Validates a spec at any pipeline stage. */
export function validateVideoSpec(input: unknown): SpecValidationResult<VideoSpec> {
  return toResult(VideoSpecSchema.safeParse(input));
}

/** Validates a spec before rendering: script and scenes are required. */
export function validateRenderableVideoSpec(
  input: unknown,
): SpecValidationResult<RenderableVideoSpec> {
  return toResult(RenderableVideoSpecSchema.safeParse(input));
}
