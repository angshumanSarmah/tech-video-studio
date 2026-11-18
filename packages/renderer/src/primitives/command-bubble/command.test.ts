import { describe, expect, it } from 'vitest';
import { splitCommand, visibleCommand } from './command.ts';

describe('splitCommand', () => {
  it('splits the verb from the rest, keeping spacing', () => {
    expect(splitCommand('SET user:42 "x"')).toEqual({ verb: 'SET', rest: ' user:42 "x"' });
    expect(splitCommand('PING')).toEqual({ verb: 'PING', rest: '' });
  });
});

describe('visibleCommand', () => {
  it('reveals the verb first, then the rest', () => {
    const parts = splitCommand('GET k');
    expect(visibleCommand(parts, 2)).toEqual({ verb: 'GE', rest: '' });
    expect(visibleCommand(parts, 4)).toEqual({ verb: 'GET', rest: ' ' });
    expect(visibleCommand(parts, 5)).toEqual(parts);
  });
});
