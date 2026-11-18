import { describe, expect, it } from 'vitest';
import { dataLines, formatDataValue, lineText, visibleParts } from './lines.ts';

describe('dataLines', () => {
  it('prints JSON-like rows with commas between fields', () => {
    const lines = dataLines([
      { key: 'rider', value: 'u_42' },
      { key: 'eta_min', value: 4 },
      { key: 'surge', value: false },
      { key: 'driver', value: null },
    ]).map(lineText);
    expect(lines).toEqual([
      '  "rider": "u_42",',
      '  "eta_min": 4,',
      '  "surge": false,',
      '  "driver": null',
    ]);
  });

  it('escapes quotes in string values', () => {
    expect(formatDataValue('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('visibleParts', () => {
  const [line] = dataLines([{ key: 'k', value: 'v' }]);

  it('cuts the parts in order', () => {
    if (!line) throw new Error('no line');
    expect(visibleParts(line, 0)).toEqual({ indent: '', key: '', value: '', comma: '' });
    expect(visibleParts(line, 4)).toEqual({ indent: '  ', key: '"k', value: '', comma: '' });
    expect(visibleParts(line, 99)).toEqual(line);
  });
});
