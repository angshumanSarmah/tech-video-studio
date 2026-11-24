import {
  RunSettingsConflictError,
  type ApiError,
  type ApiErrorCode,
} from '@explainer-studio/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { RunHasExportsError } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';

type Issues = NonNullable<ApiError['error']['issues']>;

/** The single place that writes an error body, so every `/api` error has the same shape. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  issues?: Issues,
): Response {
  const body: ApiError = { error: { code, message, ...(issues && { issues }) } };
  return c.json(body, status);
}

export function validationError(c: Context, error: z.ZodError): Response {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  return apiError(c, 400, 'bad_request', 'Invalid request', issues);
}

/** `app.onError`: maps domain errors to statuses; anything unexpected is a logged 500. */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof NotFoundError) return apiError(c, 404, 'not_found', err.message);
  if (err instanceof RunHasExportsError) return apiError(c, 409, 'conflict', err.message);
  if (err instanceof RunSettingsConflictError) return apiError(c, 400, 'bad_request', err.message);
  if (err instanceof HTTPException && err.status < 500) {
    return apiError(c, err.status, 'bad_request', err.message);
  }
  console.error('[server] unhandled error', err);
  return apiError(c, 500, 'internal', 'Internal server error');
}
