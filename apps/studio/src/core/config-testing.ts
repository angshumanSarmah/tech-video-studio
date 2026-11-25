import { SettingsSchema } from '@explainer-studio/shared';
import { parseEnv, resolveConfig, type AppConfig } from './config.ts';
import { findWorkspaceRoot } from './workspace-root.ts';

/** Test-only. Config for a test data dir: defaults, no API key, no dry-run dir. */
export function testConfig(dataDir: string): AppConfig {
  return resolveConfig(
    parseEnv({ DATA_DIR: dataDir }),
    SettingsSchema.parse({}),
    findWorkspaceRoot(import.meta.dirname),
  );
}
