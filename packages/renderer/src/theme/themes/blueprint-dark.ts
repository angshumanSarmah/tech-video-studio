import type { ThemeInput } from '../schema.ts';

const MONO_FALLBACK = "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Menlo, Consolas, monospace";

/** Default theme: deep navy blueprint board with a drifting grid and glowing semantic colours. */
export const blueprintDark = {
  id: 'blueprint-dark',
  name: 'Blueprint Dark',
  description: 'Deep navy blueprint board, drifting grid, glowing semantic colours. 1080×1920.',
  canvas: { width: 1080, height: 1920 },
  numberLocale: 'en-IN',
  colours: {
    background: '#060c1d',
    vignette: '#02050f',
    surface: '#0b1530',
    surfaceRaised: '#10203f',
    line: '#1d3160',
    ink: { primary: '#e6edf7', muted: '#8c9cc0', faint: '#56678c' },
    semantic: {
      neutral: '#e6edf7',
      focus: '#ffd84d',
      ok: '#3ddc97',
      problem: '#ff5c6c',
      concept: '#4f8cff',
    },
    fallbackAccent: '#4f8cff',
  },
  tint: { softAlpha: 0.14, borderAlpha: 0.7 },
  glow: { innerBlur: 6, innerAlpha: 0.75, outerBlur: 22, outerAlpha: 0.4 },
  minimumContrast: { text: 4.5, graphic: 3 },
  grid: {
    minorCell: 36,
    majorEvery: 5,
    colour: '#4f8cff',
    minorAlpha: 0.07,
    majorAlpha: 0.13,
    drift: { x: 0, y: -6 },
  },
  fonts: {
    display: {
      family: 'Barlow Condensed',
      fallback: "'Arial Narrow', sans-serif",
      // Arrows, check marks and ₹ come from Inter (Barlow has none).
      bundledFallbacks: ['sans'],
      files: [
        { weight: 600, path: 'fonts/barlow-condensed/barlow-condensed-600.woff2' },
        { weight: 700, path: 'fonts/barlow-condensed/barlow-condensed-700.woff2' },
      ],
    },
    mono: {
      family: 'JetBrains Mono',
      fallback: MONO_FALLBACK,
      // ₹ comes from Inter.
      bundledFallbacks: ['sans'],
      files: [
        { weight: 500, path: 'fonts/jetbrains-mono/jetbrains-mono-500.woff2' },
        { weight: 700, path: 'fonts/jetbrains-mono/jetbrains-mono-700.woff2' },
      ],
    },
    sans: {
      family: 'Inter',
      fallback: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      files: [
        { weight: 400, path: 'fonts/inter/inter-400.woff2' },
        { weight: 600, path: 'fonts/inter/inter-600.woff2' },
        { weight: 700, path: 'fonts/inter/inter-700.woff2' },
      ],
    },
  },
  text: {
    headline: {
      font: 'display',
      size: 60,
      weight: 700,
      letterSpacing: 0.01,
      lineHeight: 1.05,
      uppercase: true,
    },
    // Big numbers: counter and stat values.
    metric: {
      font: 'display',
      size: 132,
      weight: 700,
      letterSpacing: 0,
      lineHeight: 1,
      uppercase: false,
    },
    title: {
      font: 'display',
      size: 56,
      weight: 600,
      letterSpacing: 0.02,
      lineHeight: 1.1,
      uppercase: true,
    },
    // HUD chapter header: below the 60 px headline in the hierarchy, so a question fits one line.
    chapter: {
      font: 'display',
      size: 40,
      weight: 600,
      letterSpacing: 0.02,
      lineHeight: 1.1,
      uppercase: true,
    },
    body: {
      font: 'sans',
      size: 38,
      weight: 400,
      letterSpacing: 0,
      lineHeight: 1.3,
      uppercase: false,
    },
    subtitle: {
      font: 'sans',
      size: 54,
      weight: 600,
      letterSpacing: 0,
      lineHeight: 1.2,
      uppercase: false,
    },
    tag: {
      font: 'mono',
      size: 30,
      weight: 700,
      letterSpacing: 0.12,
      lineHeight: 1,
      uppercase: true,
    },
    label: {
      font: 'mono',
      size: 24,
      weight: 500,
      letterSpacing: 0.14,
      lineHeight: 1.2,
      uppercase: true,
    },
    // HUD rows (top bar, step tracker, hero pill, story clock): tighter than `label` so two
    // items share a row.
    hud: {
      font: 'mono',
      size: 22,
      weight: 500,
      letterSpacing: 0.08,
      lineHeight: 1.2,
      uppercase: true,
    },
    footnote: {
      font: 'sans',
      size: 22,
      weight: 400,
      letterSpacing: 0,
      lineHeight: 1.3,
      uppercase: false,
    },
  },
  space: { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, xxl: 96 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  stroke: { hairline: 1.5, thin: 2, regular: 4, bold: 6 },
  // Check zones with `calibrate:safe-area <shorts|reels>`.
  safeArea: {
    platforms: {
      // Measured on a 1080x2340 phone screenshot on 2026-11-18. Tall phones scale the 9:16
      // frame to fill the height and crop ~40 px per side.
      shorts: {
        topBar: { x: 0, y: 0, width: 1080, height: 140 },
        actions: { x: 900, y: 1020, width: 180, height: 880 },
        bottomInfo: { x: 0, y: 1660, width: 1080, height: 260 },
      },
      // Measured on 1080x2340 screenshots (Reels tab and feed) on 2026-11-19. The Reels tab shows
      // the 9:16 frame 1:1 with no crop; the feed puts an account header over the top and trims
      // ~60 px top and bottom.
      reels: {
        topBar: { x: 0, y: 0, width: 1080, height: 200 },
        actions: { x: 940, y: 1160, width: 140, height: 760 },
        bottomInfo: { x: 0, y: 1700, width: 1080, height: 220 },
      },
    },
    // Covers the side cropping on tall phones.
    gutter: 72,
    hudBand: 200,
    // One 60 px headline line (two at most); reserved only on beats that show a headline.
    headlineBand: 140,
    subtitleBand: 180,
  },
} satisfies ThemeInput;
