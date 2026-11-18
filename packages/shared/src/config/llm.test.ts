import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODELS,
  LlmSettingsSchema,
  MODEL_ROLES,
  UtcWindowSchema,
  defaultPriceTable,
} from './llm.ts';

const messages = (input: unknown): string[] => {
  const result = LlmSettingsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('LlmSettingsSchema defaults', () => {
  const llm = LlmSettingsSchema.parse({});

  it('uses DeepSeek V4 Pro for the director and V4.1 Flash for every other role', () => {
    for (const role of MODEL_ROLES) {
      const expected = role === 'director' ? DEEPSEEK_MODELS.v4Pro : DEEPSEEK_MODELS.v41Flash;
      expect(llm.models[role]).toBe(expected);
    }
  });

  it('points at the DeepSeek API with no key', () => {
    expect(llm.baseUrl).toBe(DEEPSEEK_BASE_URL);
    expect(llm.apiKey).toBeUndefined();
  });

  it('prices both default models with the half-price off-peak rule', () => {
    expect(Object.keys(llm.prices).sort()).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(llm.prices['deepseek-v4-pro']).toMatchObject({
      inputCacheHitPerMTok: 0.044,
      inputCacheMissPerMTok: 1.32,
      outputPerMTok: 3.96,
      offPeak: { multiplier: 0.5, peakDaysUtc: [1, 2, 3, 4, 5] },
    });
  });

  it('keeps unspecified roles at their defaults when one role is overridden', () => {
    const custom = LlmSettingsSchema.parse({ models: { curator: DEEPSEEK_MODELS.v4Pro } });
    expect(custom.models.curator).toBe(DEEPSEEK_MODELS.v4Pro);
    expect(custom.models.researcher).toBe(DEEPSEEK_MODELS.v41Flash);
  });

  it('returns a fresh price table each time', () => {
    expect(defaultPriceTable()).not.toBe(defaultPriceTable());
    expect(LlmSettingsSchema.parse({}).prices).not.toBe(LlmSettingsSchema.parse({}).prices);
  });
});

describe('LlmSettingsSchema validation', () => {
  it('rejects a role model that has no price entry, naming the role', () => {
    expect(messages({ models: { director: 'unknown-model' } })).toEqual([
      'models.director: Model "unknown-model" has no entry in llm.prices',
    ]);
  });

  it('rejects an unknown role', () => {
    expect(messages({ models: { narrator: 'deepseek-flash' } })).toHaveLength(1);
  });

  it('rejects negative prices and a non-URL base URL', () => {
    const prices = defaultPriceTable();
    prices['deepseek-flash'] = { ...prices['deepseek-flash']!, outputPerMTok: -1 };
    expect(messages({ baseUrl: 'not a url', prices })).toEqual([
      expect.stringMatching(/^baseUrl: /),
      expect.stringMatching(/^prices\.deepseek-flash\.outputPerMTok: /),
    ]);
  });

  it('rejects an off-peak multiplier above 1', () => {
    const prices = defaultPriceTable();
    prices['deepseek-flash']!.offPeak!.multiplier = 1.5;
    expect(messages({ prices })).toEqual([
      expect.stringMatching(/^prices\.deepseek-flash\.offPeak\.multiplier: /),
    ]);
  });
});

describe('UtcWindowSchema', () => {
  it('accepts a window ending at 24:00', () => {
    expect(UtcWindowSchema.safeParse({ start: '22:00', end: '24:00' }).success).toBe(true);
  });

  it.each([
    ['malformed time', { start: '1:00', end: '04:00' }],
    ['hour out of range', { start: '01:00', end: '25:00' }],
    ['start after end', { start: '22:00', end: '02:00' }],
  ])('rejects %s', (_label, window) => {
    expect(UtcWindowSchema.safeParse(window).success).toBe(false);
  });
});
