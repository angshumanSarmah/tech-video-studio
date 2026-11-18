import { z } from 'zod';

export const API_ERROR_CODES = ['bad_request', 'not_found', 'conflict', 'internal'] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Body of every non-2xx `/api` response. `issues` lists validation failures by path. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
