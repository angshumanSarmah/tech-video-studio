import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_THEME_ID, getTheme } from '@explainer-studio/renderer/theme';
import { describe, expect, it } from 'vitest';
import {
  buildThemeCss,
  expectedThemeCss,
  GENERATED_CSS_PATH,
  STUDIO_THEME_ID,
} from './theme-css.ts';

describe('studio theme CSS', () => {
  it('is up to date with the renderer theme (run `pnpm --filter @explainer-studio/studio gen:theme`)', () => {
    expect(readFileSync(GENERATED_CSS_PATH, 'utf8')).toBe(expectedThemeCss());
  });

  it('stays on the dark studio theme, independent of the default video theme', () => {
    expect(STUDIO_THEME_ID).toBe('blueprint-dark');
    expect(DEFAULT_THEME_ID).not.toBe(STUDIO_THEME_ID);
    expect(expectedThemeCss()).toContain('Generated from the renderer theme "blueprint-dark"');
  });

  it('points every @font-face at a bundled font file', () => {
    const urls = [...expectedThemeCss().matchAll(/url\('([^']+)'\)/g)].map((m) => m[1] ?? '');
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(existsSync(resolve(dirname(GENERATED_CSS_PATH), url)), url).toBe(true);
    }
  });

  it('maps theme colours and the mono font to the studio token names', () => {
    const theme = getTheme('blueprint-dark');
    const css = buildThemeCss(theme, (path) => `/x/${path}`);
    expect(css).toContain(`--color-canvas: ${theme.colours.background};`);
    expect(css).toContain(`--color-problem: ${theme.colours.semantic.problem};`);
    expect(css).toContain('--color-grid: rgb(79 140 255 / 0.07);');
    expect(css).toContain("--font-mono: 'JetBrains Mono', ");
    expect(css).toContain("--font-mono: 'JetBrains Mono', 'Inter', ");
    expect(css).toContain("url('/x/fonts/jetbrains-mono/jetbrains-mono-700.woff2')");
    // The mono stack's bundled fallback (Inter, for ₹) is loaded too.
    expect(css).toContain("url('/x/fonts/inter/inter-400.woff2')");
  });
});
