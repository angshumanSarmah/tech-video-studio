import type { z } from 'zod';
import { findSpecWarnings, type SpecIssue } from './integrity/index.ts';
import {
  RenderableVideoSpecShapeSchema,
  VideoSpecShapeSchema,
  type RenderableVideoSpec,
  type VideoSpec,
} from './shape.ts';
import { RenderableVideoSpecSchema, VideoSpecSchema } from './video-spec.ts';

export interface SpecError {
  /** JSON path, e.g. `$.scenes[2].events[0].at.index`. */
  path: string;
  /** Zod issue code, or a `SpecErrorCode` / `SpecWarningCode`. */
  code: string;
  message: string;
}

/**
 * `errors` make the spec invalid. `warnings` never do; they are reported whenever the spec's
 * structure parses, even alongside cross-reference errors.
 */
export type SpecValidationResult<T> =
  | { ok: true; spec: T; errors: []; warnings: SpecError[] }
  | { ok: false; spec: undefined; errors: SpecError[]; warnings: SpecError[] };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function toJsonPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    const name = String(key);
    return IDENTIFIER.test(name) ? `${acc}.${name}` : `${acc}[${JSON.stringify(name)}]`;
  }, '$');
}

function fromZodIssue(issue: z.core.$ZodIssue): SpecError {
  const params =
    issue.code === 'custom' ? (issue.params as { code?: unknown } | undefined) : undefined;
  const code = typeof params?.code === 'string' ? params.code : issue.code;
  return { path: toJsonPath(issue.path), code, message: issue.message };
}

function fromSpecIssue(issue: SpecIssue): SpecError {
  return { path: toJsonPath(issue.path), code: issue.code, message: issue.message };
}

function warningsFor(spec: VideoSpec): SpecError[] {
  return findSpecWarnings(spec).map(fromSpecIssue);
}

function validateWith<T extends VideoSpec>(
  schema: z.ZodType<T>,
  shapeSchema: z.ZodType<T>,
  input: unknown,
): SpecValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, spec: parsed.data, errors: [], warnings: warningsFor(parsed.data) };
  }
  const shape = shapeSchema.safeParse(input);
  return {
    ok: false,
    spec: undefined,
    errors: parsed.error.issues.map(fromZodIssue),
    warnings: shape.success ? warningsFor(shape.data) : [],
  };
}

/** Validates a spec at any pipeline stage. */
export function validateVideoSpec(input: unknown): SpecValidationResult<VideoSpec> {
  return validateWith(VideoSpecSchema, VideoSpecShapeSchema, input);
}

/** Validates a spec before rendering: script and scenes are required. */
export function validateRenderableVideoSpec(
  input: unknown,
): SpecValidationResult<RenderableVideoSpec> {
  return validateWith(RenderableVideoSpecSchema, RenderableVideoSpecShapeSchema, input);
}
