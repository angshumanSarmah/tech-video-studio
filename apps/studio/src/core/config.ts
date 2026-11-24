import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  EnvSchema,
  SettingsSchema,
  type Env,
  type LlmSettings,
  type RenderSettings,
  type BudgetSettings,
  type ResearchSettings,
  type Settings,
  type SettingsInput,
  type TimingSettings,
  type TtsSettings,
  type VideoSettings,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { findWorkspaceRoot } from './workspace-root.ts';

export const SETTINGS_FILENAME = 'config.json';

/** Thrown for any invalid or unreadable config. The message is meant to be shown as-is. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Fully resolved config: env bootstrap values merged with `config.json`, paths made absolute. */
export interface AppConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly settingsPath: string;
  readonly port: number;
  /** `apiKey` is DEEPSEEK_API_KEY from .env if set, otherwise `llm.apiKey` from config.json. */
  readonly llm: LlmSettings;
  /** `binaryPath` is absolute. */
  readonly tts: TtsSettings;
  /** Narration pauses (gap, landing hold, tail); a run's `settings.timing` overrides them. */
  readonly timing: TimingSettings;
  readonly render: RenderSettings;
  /** Length, parts and pace for agent prompts; a run's `settings.video` overrides them. */
  readonly video: VideoSettings;
  /** Researcher input limits (source token budget). */
  readonly research: ResearchSettings;
  /** Cost caps; a run's `settings.budget` overrides them. */
  readonly budget: BudgetSettings;
}

type RawEnv = Record<string, string | undefined>;

function validate<T extends z.ZodType>(schema: T, input: unknown, source: string): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ConfigError(`Invalid config in ${source}:\n${z.prettifyError(result.error)}`);
}

function resolveFromRoot(workspaceRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

/** Pure: validates raw env. Empty strings (e.g. `DEEPSEEK_API_KEY=`) count as unset. */
export function parseEnv(raw: RawEnv): Env {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  return validate(EnvSchema, cleaned, 'environment (.env)');
}

/** Pure: validates settings and applies defaults. `source` names the origin in error messages. */
export function parseSettings(input: unknown, source = 'settings'): Settings {
  return validate(SettingsSchema, input, source);
}

/** Pure: parses `config.json` text. */
export function parseSettingsText(text: string, source: string): Settings {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${source} is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return parseSettings(json, source);
}

export function settingsPathFor(dataDir: string): string {
  return join(dataDir, SETTINGS_FILENAME);
}

/** Pure: merges env and settings into the runtime config. Env wins for the API key. */
export function resolveConfig(env: Env, settings: Settings, workspaceRoot: string): AppConfig {
  const dataDir = resolveFromRoot(workspaceRoot, env.DATA_DIR);
  return {
    workspaceRoot,
    dataDir,
    settingsPath: settingsPathFor(dataDir),
    port: env.PORT,
    llm: { ...settings.llm, apiKey: env.DEEPSEEK_API_KEY ?? settings.llm.apiKey },
    tts: { ...settings.tts, binaryPath: resolveFromRoot(workspaceRoot, settings.tts.binaryPath) },
    timing: settings.timing,
    render: settings.render,
    video: settings.video,
    research: settings.research,
    budget: settings.budget,
  };
}

/** Reads `config.json`; a missing file yields defaults. Never writes. */
export function readSettings(settingsPath: string): Settings {
  if (!existsSync(settingsPath)) return parseSettings({}, 'defaults');
  let text: string;
  try {
    text = readFileSync(settingsPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read ${settingsPath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return parseSettingsText(text, settingsPath);
}

export interface LoadConfigOptions {
  /** Where to start looking for the workspace root. Defaults to `process.cwd()`. */
  readonly startDir?: string;
  /** Env to use instead of `process.env` (which is first populated from the root `.env`). */
  readonly env?: RawEnv;
}

function loadProcessEnv(workspaceRoot: string): RawEnv {
  const envFile = join(workspaceRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return process.env;
}

/** Loads `.env` and `<dataDir>/config.json`, validates both and resolves the runtime config. */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const workspaceRoot = findWorkspaceRoot(options.startDir ?? process.cwd());
  const env = parseEnv(options.env ?? loadProcessEnv(workspaceRoot));
  const dataDir = resolveFromRoot(workspaceRoot, env.DATA_DIR);
  return resolveConfig(env, readSettings(settingsPathFor(dataDir)), workspaceRoot);
}

/**
 * Validates `input` and writes the full settings (defaults included) to `<dataDir>/config.json`.
 * Nothing is written if validation fails. The write is atomic (temp file + rename).
 * Pass settings, not an `AppConfig`: env-sourced values such as the API key must not be persisted.
 */
export function saveConfig(input: SettingsInput, dataDir: string): Settings {
  const settings = parseSettings(input);
  const settingsPath = settingsPathFor(dataDir);
  const tmpPath = `${settingsPath}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, settingsPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw new ConfigError(`Could not write ${settingsPath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return settings;
}
