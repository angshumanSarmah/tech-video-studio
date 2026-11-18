import type { ThemeInput } from '../schema.ts';

const MONO_FALLBACK = "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Menlo, Consolas, monospace";

/** Default theme: deep navy blueprint board with a drifting grid and glowing semantic colours. */
export const blueprintDark = {
  id: 'blueprint-dark',
  name: 'Blueprint Dark',
  description: 'Deep navy blueprint board, drifting grid, glowing semantic colours. 1080×1920.',
  canvas: { width: 1080, height: 1920 },
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
      files: [
        { weight: 600, path: 'fonts/barlow-condensed/barlow-condensed-latin-600-normal.woff2' },
        { weight: 700, path: 'fonts/barlow-condensed/barlow-condensed-latin-700-normal.woff2' },
      ],
    },
    mono: {
      family: 'JetBrains Mono',
      fallback: MONO_FALLBACK,
      files: [
        { weight: 500, path: 'fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2' },
        { weight: 700, path: 'fonts/jetbrains-mono/jetbrains-mono-latin-700-normal.woff2' },
      ],
    },
    sans: {
      family: 'Inter',
      fallback: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      files: [
        { weight: 400, path: 'fonts/inter/inter-latin-400-normal.woff2' },
        { weight: 600, path: 'fonts/inter/inter-latin-600-normal.woff2' },
      ],
    },
  },
  text: {
    headline: {
      font: 'display',
      size: 84,
      weight: 700,
      letterSpacing: 0.01,
      lineHeight: 1.02,
      uppercase: true,
    },
    title: {
      font: 'display',
      size: 56,
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
  // Starting values, not yet calibrated: check with `calibrate:safe-area <shorts|reels>`.
  safeArea: {
    platforms: {
      shorts: {
        topBar: { x: 0, y: 0, width: 1080, height: 180 },
        actions: { x: 930, y: 900, width: 150, height: 620 },
        bottomInfo: { x: 0, y: 1520, width: 1080, height: 400 },
      },
      reels: {
        topBar: { x: 0, y: 0, width: 1080, height: 220 },
        actions: { x: 940, y: 960, width: 140, height: 600 },
        bottomInfo: { x: 0, y: 1500, width: 1080, height: 420 },
      },
    },
    gutter: 48,
    hudBand: 200,
    subtitleBand: 180,
  },
} satisfies ThemeInput;
