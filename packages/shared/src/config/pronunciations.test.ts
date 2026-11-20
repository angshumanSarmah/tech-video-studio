import { describe, expect, it } from 'vitest';
import { DEFAULT_PRONUNCIATIONS, PronunciationsSchema } from './pronunciations.ts';

describe('PronunciationsSchema', () => {
  it('accepts the defaults', () => {
    expect(PronunciationsSchema.parse(DEFAULT_PRONUNCIATIONS)).toEqual(DEFAULT_PRONUNCIATIONS);
  });

  it.each(['two words', ' Redis', 'Redis,', '"quoted"', '', '-'])('rejects key %j', (key) => {
    expect(PronunciationsSchema.safeParse({ [key]: 'x' }).success).toBe(false);
  });

  it.each(['k8s', 'gRPC', "o'clock", 'rate-limiter', '429'])('accepts key %j', (key) => {
    expect(PronunciationsSchema.safeParse({ [key]: 'x' }).success).toBe(true);
  });

  it('trims the replacement and rejects one without a letter or digit', () => {
    expect(PronunciationsSchema.parse({ UPI: '  U P I ' })).toEqual({ UPI: 'U P I' });
    expect(PronunciationsSchema.safeParse({ UPI: ' - ' }).success).toBe(false);
  });
});
