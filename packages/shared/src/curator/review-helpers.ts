import { toJsonPath } from '../spec/validate.ts';
import type { ReviewProblem, ReviewProblemCode } from './review-checks.ts';

/** Small helpers the review checks share (internal: not exported by the package). */

export type Path = (string | number)[];
export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;
export const problem = (path: Path, code: ReviewProblemCode, message: string): ReviewProblem => ({
  path: toJsonPath(path),
  code,
  message,
});
