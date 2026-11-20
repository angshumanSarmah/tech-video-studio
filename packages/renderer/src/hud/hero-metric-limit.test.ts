import { HERO_METRIC_MAX_CHARS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { roomInChars } from '../fonts/measure-text.ts';
import { getTheme } from '../theme/index.ts';
import { dimensionChrome, STEP_DOT } from './hud-slots.ts';
import { titleBlockLayout } from './title-block.ts';

/** Steps the limit leaves room for on the metric row (5-8 beats rarely make more chapters). */
const MARKER_STEPS = 5;

describe('HERO_METRIC_MAX_CHARS', () => {
  it("is what the default theme's metric row holds beside a 5-step marker", () => {
    const theme = getTheme();
    const { space } = theme;
    const marker = MARKER_STEPS * STEP_DOT + (MARKER_STEPS - 1) * space.xs + space.md;
    const room = titleBlockLayout(theme, 'strip').metaRow.width - marker - dimensionChrome(theme);
    expect(HERO_METRIC_MAX_CHARS).toBe(roomInChars(theme, 'hud', room));
  });
});
