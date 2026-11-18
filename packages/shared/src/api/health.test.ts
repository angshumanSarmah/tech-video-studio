import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.ts';

describe('HealthResponseSchema', () => {
  it('accepts a valid payload', () => {
    expect(HealthResponseSchema.parse({ status: 'ok', uptimeSeconds: 1.5 })).toEqual({
      status: 'ok',
      uptimeSeconds: 1.5,
    });
  });

  it('rejects an unknown status', () => {
    expect(HealthResponseSchema.safeParse({ status: 'down', uptimeSeconds: 0 }).success).toBe(
      false,
    );
  });

  it('rejects negative uptime', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', uptimeSeconds: -1 }).success).toBe(false);
  });
});
