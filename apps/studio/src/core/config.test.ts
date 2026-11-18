import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  loadConfig,
  parseEnv,
  parseSettings,
  parseSettingsText,
  resolveConfig,
  saveConfig,
} from './config.ts';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({})).toEqual({ DATA_DIR: './data', PORT: 4311 });
  });

  it('coerces PORT and treats empty strings as unset', () => {
    expect(parseEnv({ PORT: '9000', DATA_DIR: '', DEEPSEEK_API_KEY: '' })).toEqual({
      DATA_DIR: './data',
      PORT: 9000,
    });
  });

  it('throws a ConfigError naming the field for an invalid PORT', () => {
    expect(() => parseEnv({ PORT: '70000' })).toThrow(ConfigError);
    expect(() => parseEnv({ PORT: '70000' })).toThrow(/environment \(\.env\)[\s\S]*PORT/);
  });
});

describe('parseSettingsText', () => {
  it('reports malformed JSON with the source', () => {
    expect(() => parseSettingsText('{ nope', '/x/config.json')).toThrow(
      /^\/x\/config\.json is not valid JSON: /,
    );
  });

  it('reports schema errors with the field path', () => {
    const run = (): unknown => parseSettingsText('{"render":{"concurrency":"lots"}}', 'cfg');
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/Invalid config in cfg:[\s\S]*render\.concurrency/);
  });
});

describe('resolveConfig', () => {
  const ROOT = '/repo';
  const settings = parseSettings({ llm: { apiKey: 'file-key' } });

  it('resolves relative paths from the workspace root and keeps absolute ones', () => {
    const config = resolveConfig(parseEnv({}), settings, ROOT);
    expect(config.dataDir).toBe('/repo/data');
    expect(config.settingsPath).toBe('/repo/data/config.json');
    expect(config.tts.binaryPath).toBe('/repo/apps/studio/tts-python/.venv/bin/python');
    expect(resolveConfig(parseEnv({ DATA_DIR: '/var/studio' }), settings, ROOT).dataDir).toBe(
      '/var/studio',
    );
  });

  it('prefers DEEPSEEK_API_KEY from env over the key in config.json', () => {
    expect(resolveConfig(parseEnv({}), settings, ROOT).llm.apiKey).toBe('file-key');
    const env = parseEnv({ DEEPSEEK_API_KEY: 'env-key' });
    expect(resolveConfig(env, settings, ROOT).llm.apiKey).toBe('env-key');
  });
});

describe('loadConfig / saveConfig (filesystem)', () => {
  let root: string;
  let dataDir: string;
  const load = (env: Record<string, string> = {}): ReturnType<typeof loadConfig> =>
    loadConfig({ startDir: root, env: { DATA_DIR: 'data', ...env } });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'studio-config-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
    dataDir = join(root, 'data');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns defaults when config.json is missing, without creating it', () => {
    const config = load();
    expect(config.dataDir).toBe(dataDir);
    expect(config.llm.models.director).toBe('deepseek-v4-pro');
    expect(config.render.presets.final).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(existsSync(config.settingsPath)).toBe(false);
  });

  it('round-trips: saved settings load back identically', () => {
    const saved = saveConfig(
      {
        llm: { models: { scriptwriter: 'deepseek-v4-pro' } },
        tts: { voice: 'am_michael', speed: 1.1 },
        render: { concurrency: 2 },
      },
      dataDir,
    );
    const config = load();
    expect(config.llm).toEqual(saved.llm);
    expect(config.render).toEqual(saved.render);
    expect(config.tts.voice).toBe('am_michael');
    expect(config.tts.speed).toBe(1.1);
  });

  it('writes the full settings, defaults included, as formatted JSON', () => {
    saveConfig({}, dataDir);
    const text = readFileSync(join(dataDir, 'config.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(parseSettings({}));
  });

  it('does not write anything when validation fails', () => {
    expect(() => saveConfig({ render: { concurrency: 0 } }, dataDir)).toThrow(
      /render\.concurrency/,
    );
    expect(existsSync(dataDir)).toBe(false);
  });

  it('keeps the previous file intact and leaves no temp files after a failed save', () => {
    saveConfig({ render: { concurrency: 2 } }, dataDir);
    expect(() => saveConfig({ tts: { voice: '' } }, dataDir)).toThrow(ConfigError);
    expect(load().render.concurrency).toBe(2);
    expect(readdirSync(dataDir)).toEqual(['config.json']);
  });

  it('fails loudly with the file path when config.json is invalid', () => {
    mkdirSync(dataDir);
    const path = join(dataDir, 'config.json');
    writeFileSync(path, JSON.stringify({ llm: { models: { director: 'gpt-x' } } }));
    expect(() => load()).toThrow(ConfigError);
    expect(() => load()).toThrow(
      new RegExp(
        `Invalid config in ${path}:[\\s\\S]*no entry in llm\\.prices[\\s\\S]*llm\\.models\\.director`,
      ),
    );
  });

  it('does not persist an API key that came from env', () => {
    const config = load({ DEEPSEEK_API_KEY: 'env-key' });
    expect(config.llm.apiKey).toBe('env-key');
    saveConfig({}, config.dataDir);
    expect(load().llm.apiKey).toBeUndefined();
  });
});
