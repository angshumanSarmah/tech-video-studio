import { z } from 'zod';

/**
 * Process env contract for the server and worker (loaded from the repo-root `.env`).
 * Only bootstrap values and secrets live here; editable settings live in `SettingsSchema`.
 */
export const EnvSchema = z.object({
  // Optional at boot so the app starts without a key; the LLM client must fail fast when missing.
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).default('./data'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4311),
});

export type Env = z.infer<typeof EnvSchema>;
