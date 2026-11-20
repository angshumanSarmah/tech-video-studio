import { describe, expect, it } from 'vitest';
import { mainTerm, mentionsTerm } from './terms.ts';

describe('mentionsTerm', () => {
  it('finds terms in any case, plural, singular or inflected, across hyphens', () => {
    expect(mentionsTerm('Two Token-Buckets fill', 'token bucket')).toBe(true);
    expect(mentionsTerm('It fails closed', 'fail closed')).toBe(true);
    expect(mentionsTerm('A rate limiter counts', 'Rate limiters')).toBe(true);
    expect(mentionsTerm('backlogs', 'backlog')).toBe(true);
    expect(mentionsTerm('a tokenbucket', 'token bucket')).toBe(false);
    expect(mentionsTerm('backlogger', 'backlog')).toBe(false);
    expect(mentionsTerm('the status code', 'status')).toBe(true);
  });
});

describe('mainTerm', () => {
  const glossary = ['capacity', 'token bucket', 'shared store', 'fail closed'];

  it('is the longest topic or glossary term the title names', () => {
    expect(mainTerm('One shared token bucket, 24 gateways', 'Rate limiters', glossary)).toBe(
      'token bucket',
    );
    expect(mainTerm('How rate limiters keep capacity', 'Rate limiters', glossary)).toBe(
      'Rate limiters',
    );
  });

  it('falls back to the topic title', () => {
    expect(mainTerm('Why slow limiter stores send 40x traffic', 'Rate limiters', glossary)).toBe(
      'Rate limiters',
    );
  });
});
