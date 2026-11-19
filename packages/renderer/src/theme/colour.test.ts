import { describe, expect, it } from 'vitest';
import { blendOver, contrastRatio, isHexColour, parseHex, withAlpha } from './colour.ts';

describe('colour helpers', () => {
  it('parses hex and formats it with alpha', () => {
    expect(parseHex('#4f8cff')).toEqual({ r: 79, g: 140, b: 255 });
    expect(withAlpha('#4F8CFF', 0.07)).toBe('rgb(79 140 255 / 0.07)');
  });

  it('rejects anything but 6-digit hex', () => {
    for (const bad of ['#fff', '4f8cff', '#4f8cfg', 'blue', '#4f8cff80']) {
      expect(isHexColour(bad)).toBe(false);
    }
    expect(() => parseHex('blue')).toThrow(/Invalid hex/);
  });

  it('computes WCAG contrast ratios in either order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});

describe('blendOver', () => {
  it('paints a colour at an alpha over another, as an opaque hex', () => {
    expect(blendOver('#ffffff', 0.5, '#000000')).toBe('#808080');
    expect(blendOver('#ffd84d', 0, '#f4f1ea')).toBe('#f4f1ea');
    expect(blendOver('#ffd84d', 1, '#f4f1ea')).toBe('#ffd84d');
  });
});
