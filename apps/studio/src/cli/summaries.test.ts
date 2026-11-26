import { describe, expect, it } from 'vitest';
import type { GateView } from '#core/services/gates.ts';
import { gateSummary } from './summaries.ts';

/** A draft gate view with nothing to review but the regenerate's outcome. */
function view(regenerated: GateView['regenerated']): GateView {
  return {
    runId: 1,
    gate: 'draft',
    status: 'pending',
    decidedBy: null,
    carriedFrom: null,
    notes: null,
    decidedAt: null,
    waiting: true,
    subject: null,
    content: null,
    checks: [],
    badges: [],
    blocking: [],
    warnings: [],
    regenerated,
    stills: [],
    draftPath: null,
    cost: { totalUsd: 0, byRole: [] },
  };
}

describe('gateSummary', () => {
  it("puts the last regenerate's outcome first: an unchanged one never looks like a fix", () => {
    const lines = gateSummary(
      view({
        decisionEventId: 7,
        requests: [
          {
            beatId: 'b2',
            owner: 'generator',
            fields: ['board'],
            outcome: 'unchanged',
            reason: 'the Generator could not make a valid change: The board only fits at 66%.',
          },
          { beatId: 'b2', owner: 'scriptwriter', fields: ['narration'], outcome: 'changed' },
        ],
      }),
      '/data',
    );
    expect(lines.slice(1, 3)).toEqual([
      '✗ b2 board: unchanged: the Generator could not make a valid change: The board only fits at 66%.',
      '↻ b2 narration: changed',
    ]);
  });

  it('shows nothing extra without a regenerate', () => {
    expect(gateSummary(view(null), '/data')[1]).toBe('(nothing to review yet)');
  });
});
