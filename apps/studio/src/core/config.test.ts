import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';

const ROOT = '/repo';

describe('parseConfig', () => {
  it('applies defaults and resolves DATA_DIR from the workspace root', () => {
    expect(parseConfig({}, ROOT)).toEqual({
      workspaceRoot: ROOT,
      dataDir: '/repo/data',
      port: 8787,
      deepseekApiKey: undefined,
    });
  });

  it('coerces PORT and keeps absolute DATA_DIR as-is', () => {
    const config = parseConfig({ PORT: '9000', DATA_DIR: '/var/studio' }, ROOT);
    expect(config.port).toBe(9000);
    expect(config.dataDir).toBe('/var/studio');
  });

  it('treats empty strings as unset', () => {
    const config = parseConfig({ DEEPSEEK_API_KEY: '', DATA_DIR: '', PORT: '' }, ROOT);
    expect(config.deepseekApiKey).toBeUndefined();
    expect(config.dataDir).toBe('/repo/data');
    expect(config.port).toBe(8787);
  });

  it('rejects an invalid PORT', () => {
    expect(() => parseConfig({ PORT: '70000' }, ROOT)).toThrow();
  });
});
