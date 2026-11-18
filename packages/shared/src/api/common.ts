import { z } from 'zod';

/** List responses are wrapped so pagination can be added without breaking clients. */
export const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/** Positive integer id from a path or query string. */
export const IdParamSchema = z.coerce.number().int().positive();
