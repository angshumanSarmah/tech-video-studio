import type { ThemeInput } from '../schema.ts';
import { blueprintDark } from './blueprint-dark.ts';

const INK = '#1F2328';
const DRAFTING_BLUE = '#1F4FD1';
const MONO_FALLBACK = "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Menlo, Consolas, monospace";

/**
 * Default theme: an engineering drawing on paper. Light, flat, ink line work; no glow, no vignette,
 * no drift. Focus keeps its text and strokes in ink and fills behind them with a yellow
 * highlighter (`tint.fills.focus`).
 */
export const draftingPaper = {
  id: 'drafting-paper',
  name: 'Drafting Paper',
  description: 'Warm paper, faint ruled grid, flat ink line work, highlighter focus. 1080×1920.',
  canvas: blueprintDark.canvas,
  numberLocale: 'en-IN',
  colours: {
    background: '#F4F1EA',
    // Same as the background: the paper is flat, so the vignette draws nothing.
    vignette: '#F4F1EA',
    surface: '#FAF8F3',
    surfaceRaised: '#FFFFFF',
    line: '#CFC8B8',
    // Muted is #696D74, not #6B6F76: that reads 4.48:1 on the paper, under the 4.5 text minimum.
    ink: { primary: INK, muted: '#696D74', faint: '#A7A39A' },
    semantic: {
      neutral: INK,
      // Text and strokes stay in ink; the highlighter is the fill (`tint.fills.focus`).
      focus: INK,
      ok: '#1E7B4C',
      problem: '#C62828',
      concept: DRAFTING_BLUE,
    },
    fallbackAccent: DRAFTING_BLUE,
  },
  tint: {
    softAlpha: 0.1,
    borderAlpha: 1,
    fills: { focus: { colour: '#FFD84D', alpha: 0.55 } },
  },
  // Off: a flat drawing has no glow and no drop shadow.
  glow: { innerBlur: 0, innerAlpha: 0, outerBlur: 0, outerAlpha: 0 },
  minimumContrast: { text: 4.5, graphic: 3 },
  grid: {
    minorCell: 36,
    majorEvery: 5,
    // Over the paper this draws minor lines at ~#E6E1D6 and major lines at ~#D9D3C5.
    colour: '#493300',
    minorAlpha: 0.083,
    majorAlpha: 0.16,
    drift: { x: 0, y: 0 },
  },
  fonts: {
    display: {
      family: 'IBM Plex Sans Condensed',
      fallback: "'Arial Narrow', sans-serif",
      // Plex Sans Condensed capitals are ~30% wider than Barlow's (0.57 vs 0.44 em measured).
      advanceEm: 0.65,
      bundledFallbacks: ['glyphFallback'],
      files: [
        { weight: 600, path: 'fonts/ibm-plex-sans-condensed/ibm-plex-sans-condensed-600.woff2' },
        { weight: 700, path: 'fonts/ibm-plex-sans-condensed/ibm-plex-sans-condensed-700.woff2' },
      ],
    },
    mono: {
      family: 'IBM Plex Mono',
      fallback: MONO_FALLBACK,
      advanceEm: 0.6,
      bundledFallbacks: ['glyphFallback'],
      files: [
        { weight: 500, path: 'fonts/ibm-plex-mono/ibm-plex-mono-500.woff2' },
        { weight: 700, path: 'fonts/ibm-plex-mono/ibm-plex-mono-700.woff2' },
      ],
    },
    sans: {
      family: 'IBM Plex Sans',
      fallback: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      advanceEm: 0.55,
      bundledFallbacks: ['glyphFallback'],
      files: [
        { weight: 400, path: 'fonts/ibm-plex-sans/ibm-plex-sans-400.woff2' },
        { weight: 600, path: 'fonts/ibm-plex-sans/ibm-plex-sans-600.woff2' },
        { weight: 700, path: 'fonts/ibm-plex-sans/ibm-plex-sans-700.woff2' },
      ],
    },
    // Arrows, check marks and ₹ where Plex has none.
    glyphFallback: { family: 'Inter', files: blueprintDark.fonts.sans.files },
  },
  // Same type scale, spacing and safe areas as the default, so the trial compares look only.
  text: blueprintDark.text,
  space: blueprintDark.space,
  radius: blueprintDark.radius,
  // Lighter than the default's 4 / 6 px: softer ink outlines on paper.
  stroke: { hairline: 1.5, thin: 2, regular: 2.5, bold: 4 },
  safeArea: blueprintDark.safeArea,
} satisfies ThemeInput;
