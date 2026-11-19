import { describe, expect, it } from 'vitest';
import {
  buildThemeRegistry,
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  listThemes,
} from './registry.ts';
import { ThemeSchema } from './schema.ts';
import { blueprintDark } from './themes/blueprint-dark.ts';

describe('theme registry', () => {
  it('registers valid themes with unique ids, including the default', () => {
    const themes = listThemes();
    for (const theme of themes) expect(ThemeSchema.safeParse(theme).success).toBe(true);
    expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length);
    expect(getTheme().id).toBe(DEFAULT_THEME_ID);
  });

  it('defaults to drafting-paper and keeps blueprint-dark registered and selectable', () => {
    expect(DEFAULT_THEME_ID).toBe('drafting-paper');
    expect(getTheme('blueprint-dark').id).toBe('blueprint-dark');
    expect(listThemes().map((t) => t.id)).toEqual(['blueprint-dark', 'drafting-paper']);
    expect(isThemeId('drafting-paper')).toBe(true);
  });

  it('throws on an unknown id and lists the known ones', () => {
    expect(isThemeId('neon-pink')).toBe(false);
    expect(() => getTheme('neon-pink')).toThrow(/Unknown theme "neon-pink".*blueprint-dark/);
  });

  it('rejects duplicate ids and invalid themes', () => {
    expect(() => buildThemeRegistry([blueprintDark, blueprintDark])).toThrow(/Duplicate theme id/);
    const broken = { ...blueprintDark, colours: { ...blueprintDark.colours, background: 'navy' } };
    expect(() => buildThemeRegistry([broken])).toThrow();
  });

  it('rejects a number locale the runtime cannot format', () => {
    expect(() => buildThemeRegistry([{ ...blueprintDark, numberLocale: 'not a locale' }])).toThrow(
      /number locale/,
    );
  });
});
