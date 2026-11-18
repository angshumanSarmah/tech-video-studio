import { validator } from 'hono/validator';
import type { z } from 'zod';
import { validationError } from './errors.ts';

type Target = 'json' | 'query' | 'param';

/** Zod-validates one request part; failures become a 400 in the shared error shape. */
export const validate = <T extends Target, S extends z.ZodType>(target: T, schema: S) =>
  validator(target, (value, c) => {
    const result = schema.safeParse(value);
    return result.success ? result.data : validationError(c, result.error);
  });
