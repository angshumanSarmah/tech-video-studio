import { ApiErrorSchema, type ApiError } from '@explainer-studio/shared';
import { z } from 'zod';

/** A non-2xx `/api` response. `body` is the parsed `ApiError` when the server sent one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** A 2xx response that does not match the shared schema: client and server disagree. */
export class ApiContractError extends Error {
  constructor(path: string, error: z.ZodError) {
    super(`Unexpected response from ${path}:\n${z.prettifyError(error)}`);
    this.name = 'ApiContractError';
  }
}

/**
 * The one way web code calls `/api`. Every response is parsed with its shared Zod schema, so a
 * contract drift fails loudly at the boundary instead of deep inside a component.
 */
export async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  const res = await fetch(`/api${path}`, init);
  const body = await readJson(res);
  if (!res.ok) throw toRequestError(res.status, body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiContractError(path, parsed.error);
  return parsed.data;
}

export function postJson<S extends z.ZodType>(
  path: string,
  schema: S,
  body: unknown = {},
): Promise<z.output<S>> {
  return request(path, schema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Message to show for any error thrown by an API call. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function toRequestError(status: number, body: unknown): ApiRequestError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (!parsed.success) return new ApiRequestError(status, undefined, `HTTP ${status}`);
  return new ApiRequestError(status, parsed.data, parsed.data.error.message);
}
