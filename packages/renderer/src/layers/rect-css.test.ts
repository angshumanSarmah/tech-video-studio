import { expect, it } from 'vitest';
import { rectCss } from './rect-css.ts';

it('maps x/y to left/top', () => {
  expect(rectCss({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
    position: 'absolute',
    left: 10,
    top: 20,
    width: 30,
    height: 40,
  });
});
