import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '#core/db/repositories/events.ts';
import { eventLine } from './progress.ts';

const gate = (payload: Extract<StoredEvent, { type: 'gate' }>['payload']): StoredEvent => ({
  id: 1,
  runId: 1,
  jobId: null,
  createdAt: new Date(0),
  type: 'gate',
  payload,
});

describe('eventLine: gate events', () => {
  const ctx = { label: 'run 1' };

  it('says what a person did when the gate stays pending (P1C.10 decision events)', () => {
    const base = {
      gate: 'scenes' as const,
      status: 'pending' as const,
      decidedBy: 'user' as const,
      blocking: [] as string[],
    };
    expect(eventLine(gate({ ...base, decision: { action: 'edit', note: 'n' } }), ctx)).toBe(
      'run 1 ◆ gate scenes: edited (user)',
    );
    expect(eventLine(gate({ ...base, decision: { action: 'regenerate' } }), ctx)).toBe(
      'run 1 ◆ gate scenes: regenerate requested (user)',
    );
    expect(
      eventLine(gate({ ...base, status: 'approved', decision: { action: 'approve' } }), ctx),
    ).toBe('run 1 ◆ gate scenes: approved (user)');
    expect(eventLine(gate({ gate: 'draft', status: 'pending', blocking: ['x'] }), ctx)).toBe(
      'run 1 ◆ gate draft: pending · 1 blocking',
    );
  });
});
