import { describe, expect, it } from 'vitest';
import { containsPhrase } from '../text/phrase.ts';
import { bareSourceNames, isBareSourceLine } from './source-names.ts';

describe('bareSourceNames', () => {
  it('lists site names of URL sources and single-word titles', () => {
    expect(
      bareSourceNames([
        { title: 'Scaling our queue', origin: 'https://www.engineering.acme.com/posts/queue' },
        { title: 'glyphcut', origin: 'glyphcut-readme.md' },
        { title: null, origin: 'notes.txt' },
      ]),
    ).toEqual(['engineering.acme.com', 'acme.com', 'acme', 'glyphcut']);
  });
});

describe('isBareSourceLine', () => {
  it('flags one word or a known name alone, not a publisher with what it is', () => {
    expect(isBareSourceLine('glyphcut')).toBe(true);
    expect(isBareSourceLine('  quotaflow. ')).toBe(true);
    expect(isBareSourceLine('Acme.com', ['acme.com'])).toBe(true);
    expect(isBareSourceLine('glyphcut README')).toBe(false);
    expect(isBareSourceLine('Larkspur Pay platform team, 14 March 2025', ['larkspur'])).toBe(false);
  });
});

describe('containsPhrase', () => {
  it('matches whole words in any case, optionally a plain plural', () => {
    expect(containsPhrase('Learn AI here', 'ai')).toBe(true);
    expect(containsPhrase('explain it again by email in detail', 'AI')).toBe(false);
    expect(containsPhrase('Two token-buckets', 'token bucket', { plural: true })).toBe(true);
    expect(containsPhrase('Two token buckets', 'token bucket')).toBe(false);
    expect(containsPhrase('the tokenizer', 'token', { plural: true })).toBe(false);
    expect(containsPhrase('anything', '  ')).toBe(false);
  });
});
