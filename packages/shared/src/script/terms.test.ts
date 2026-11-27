import { describe, expect, it } from 'vitest';
import { mainTerm, mentionsTerm, termForms, topicSubject } from './terms.ts';

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

/** Run 3 ("How Redis works"): the plan's terms, glossary and the last Scriptwriter answer. */
describe('run 3: terms written with alternatives', () => {
  const EVENT_LOOP =
    "Redis is an in-memory store served by one thread. That's multiplexing, an event loop: it " +
    'watches many connections and answers whichever is ready.';
  const NAIVE_RTT =
    'By default the service sends one GET and waits. Each command pays a round trip, an RTT: ' +
    "time there and back. That's about two hundred microseconds.";

  it('splits a spaced slash and a parenthesised alias into forms; keeps I/O whole', () => {
    expect(termForms('multiplexing / event loop')).toEqual(['multiplexing', 'event loop']);
    expect(termForms('round trip (RTT)')).toEqual(['round trip', 'RTT']);
    expect(termForms('AOF (append only file)')).toEqual(['AOF', 'append only file']);
    expect(termForms('sharding / multiple instances')).toEqual(['sharding', 'multiple instances']);
    expect(termForms('I/O')).toEqual(['I/O']);
    expect(termForms('pipelining')).toEqual(['pipelining']);
  });

  it('names a term when the narration uses any of its forms', () => {
    expect(mentionsTerm(EVENT_LOOP, 'multiplexing / event loop')).toBe(true);
    expect(mentionsTerm(NAIVE_RTT, 'round trip (RTT)')).toBe(true);
    expect(mentionsTerm('Each command pays an RTT.', 'round trip (RTT)')).toBe(true);
    expect(mentionsTerm('One loop watches every socket.', 'multiplexing / event loop')).toBe(false);
    // A concept headline "X = …" naming one form names the term.
    expect(mentionsTerm('round trip (RTT) ', 'round trip (RTT)')).toBe(true);
    expect(mentionsTerm('RTT ', 'round trip (RTT)')).toBe(true);
  });

  it('the main term is the topic\'s subject, not its question: "How Redis works" is Redis', () => {
    expect(topicSubject('How Redis works')).toBe('Redis');
    expect(topicSubject('What is a tokenizer?')).toBe('tokenizer');
    expect(topicSubject('Why does consistent hashing work')).toBe('consistent hashing');
    expect(topicSubject('Rate limiters')).toBe('Rate limiters');
    const glossary = ['multiplexing / event loop', 'pipelining', 'round trip (RTT)'];
    expect(mainTerm('Redis: Fast on One Thread', 'How Redis works', glossary)).toBe('Redis');
    expect(
      mentionsTerm(EVENT_LOOP, mainTerm('Redis: Fast on One Thread', 'How Redis works', glossary)),
    ).toBe(true);
  });
});
