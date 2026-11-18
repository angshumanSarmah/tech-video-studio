import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { findWorkspaceRoot } from './workspace-root.ts';

/** Process env contract for the server and worker. Studio-local, so it lives here, not in shared. */
export const EnvSchema = z.object({
  // Optional at boot so the app starts without a key; the LLM client must fail fast when missing.
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).default('./data'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly port: number;
  readonly deepseekApiKey: string | undefined;
}

type RawEnv = Record<string, string | undefined>;

/** Pure: validates raw env and resolves paths against the workspace root. */
export function parseConfig(raw: RawEnv, workspaceRoot: string): AppConfig {
  // Treat empty strings (e.g. `DEEPSEEK_API_KEY=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const env = EnvSchema.parse(cleaned);
  return {
    workspaceRoot,
    dataDir: isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(workspaceRoot, env.DATA_DIR),
    port: env.PORT,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
  };
}

/** Impure: loads `<workspaceRoot>/.env` (if present) into process.env, then parses it. */
export function loadConfig(startDir: string = process.cwd()): AppConfig {
  const workspaceRoot = findWorkspaceRoot(startDir);
  const envFile = join(workspaceRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return parseConfig(process.env, workspaceRoot);
}
