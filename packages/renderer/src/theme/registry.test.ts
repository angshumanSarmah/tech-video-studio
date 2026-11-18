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

  it('throws on an unknown id and lists the known ones', () => {
    expect(isThemeId('neon-pink')).toBe(false);
    expect(() => getTheme('neon-pink')).toThrow(/Unknown theme "neon-pink".*blueprint-dark/);
  });

  it('rejects duplicate ids and invalid themes', () => {
    expect(() => buildThemeRegistry([blueprintDark, blueprintDark])).toThrow(/Duplicate theme id/);
    const broken = { ...blueprintDark, colours: { ...blueprintDark.colours, background: 'navy' } };
    expect(() => buildThemeRegistry([broken])).toThrow();
  });
});
