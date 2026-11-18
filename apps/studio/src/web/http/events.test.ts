import { describe, expect, it } from 'vitest';
import { eventsUrl } from './events.ts';

describe('eventsUrl', () => {
  it('filters by run with a start cursor', () => {
    expect(eventsUrl({ runId: 3, after: 41 })).toBe('/api/events?runId=3&after=41');
  });

  it('filters by job without a cursor (full replay)', () => {
    expect(eventsUrl({ jobId: 7 })).toBe('/api/events?jobId=7');
  });
});
