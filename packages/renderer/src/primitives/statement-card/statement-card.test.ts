import { describe, expect, it } from 'vitest';
import { getTheme, listThemes, safeAreas } from '../../theme/index.ts';
import { lineHeightPx } from '../measure.ts';
import {
  STATEMENT_STYLE,
  statementCardSizeHints,
  StatementCardPropsSchema,
  statementHeight,
  statementMaxWidth,
} from './definition.ts';

const card = (...texts: string[]) =>
  StatementCardPropsSchema.parse({
    lines: texts.map((text, i) => ({ id: `line-${i}`, text })),
  });

describe('statement_card size hints', () => {
  it.each(listThemes().map((t) => [t.id]))('spans the stage less gutters in %s', (id) => {
    const theme = getTheme(id);
    const hints = statementCardSizeHints(card('WHY?'), theme);
    expect(hints.preferredWidth).toBe(safeAreas(theme).stage.width - 2 * theme.space.md);
    expect(hints.preferredWidth).toBe(statementMaxWidth(theme));
  });

  it('draws lines in the largest display text style', () => {
    expect(STATEMENT_STYLE).toBe('headline');
    const theme = getTheme();
    for (const style of ['title', 'chapter', 'body'] as const) {
      expect(theme.text[STATEMENT_STYLE].size).toBeGreaterThan(theme.text[style].size);
    }
  });

  it('grows taller, not smaller in type, when a line wraps', () => {
    const theme = getTheme();
    const row = lineHeightPx(theme, STATEMENT_STYLE);
    const short = statementCardSizeHints(card('EASY: FIND RIDERS.'), theme);
    const long = statementCardSizeHints(card('HARD: PICK THE RIGHT RIDER, FAST'), theme);
    expect(long.preferredWidth).toBe(short.preferredWidth);
    expect(long.preferredHeight - short.preferredHeight).toBe(row);
  });

  it('may narrow to its widest word, wrapping more', () => {
    const theme = getTheme();
    const props = card('EASY: FIND NEARBY RIDERS.', 'HARD: PICK THE RIGHT ONE.');
    const hints = statementCardSizeHints(props, theme);
    expect(hints.minWidth).toBeLessThan(hints.preferredWidth);
    expect(hints.minHeight).toBeGreaterThan(hints.preferredHeight);
    expect(hints.minHeight).toBe(statementHeight(props, theme, hints.minWidth));
  });
});
