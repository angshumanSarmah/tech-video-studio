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

describe('gateSummary at gate 1', () => {
  it('marks a thin source in the source table', () => {
    const notes = {
      facts: [],
      numbers: [],
      glossary: [],
      openQuestions: [],
    } as unknown as Extract<GateView['content'], { gate: 'research' }>['notes'];
    const stat = (sourceId: number, substantiveChars: number, thin: string[]) => ({
      sourceId,
      kind: 'url' as const,
      origin: `https://notes.example.com/${sourceId}`,
      title: null,
      status: 'extracted' as const,
      error: null,
      errorCode: null,
      read: { chars: 511, chunks: 1, sentChunks: 1, substantiveChars, thin, pointsAtImage: true },
    });
    const lines = gateSummary(
      {
        ...view(null),
        gate: 'research',
        content: {
          gate: 'research',
          notes,
          sources: [stat(1, 511, []), stat(3, 367, ['points_at_image'])] as never,
        },
      },
      '/data',
    );
    expect(lines.find((l) => l.includes('#3'))).toMatch(
      /511 chars 1\/1 chunks {2}THIN \(367 of content\)$/,
    );
    expect(lines.find((l) => l.includes('#1'))).not.toContain('THIN');
  });
});
