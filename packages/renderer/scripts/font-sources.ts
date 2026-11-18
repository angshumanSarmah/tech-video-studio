/**
 * Pinned upstream sources for every bundled font file. `fonts:subset` downloads each source,
 * checks its SHA-256, and writes a woff2 subset (`SUBSET_CODE_POINTS`) to `public/<out>`.
 * Every theme font file must have exactly one entry here (enforced by `font-coverage.test.ts`).
 */

export type FontSource = {
  /** Output path under `public/`, as referenced by the theme. */
  out: string;
  url: string;
  sha256: string;
  /** Axis values to pin when the source is a variable font. */
  axes?: Record<string, number>;
};

/** google/fonts at a fixed commit (Barlow Condensed static TTFs, Inter variable TTF). */
const GOOGLE_FONTS =
  'https://raw.githubusercontent.com/google/fonts/5bd87dfc525c8a0d1d8529d3684716e00c3fc59a';

/** Upstream JetBrains Mono v2.304: unlike the google/fonts build, it includes ✓ and ✗. */
const JETBRAINS_MONO = 'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf';

const INTER_VF = {
  url: `${GOOGLE_FONTS}/ofl/inter/Inter%5Bopsz,wght%5D.ttf`,
  sha256: '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
};

/** Inter's default optical size (text). */
const INTER_OPSZ = 14;

export const FONT_SOURCES: readonly FontSource[] = [
  {
    out: 'fonts/barlow-condensed/barlow-condensed-600.woff2',
    url: `${GOOGLE_FONTS}/ofl/barlowcondensed/BarlowCondensed-SemiBold.ttf`,
    sha256: '7b619d14bc2327509a9ef32b0890f709626f7ecc9ff61191c2a4314c5499d2d9',
  },
  {
    out: 'fonts/barlow-condensed/barlow-condensed-700.woff2',
    url: `${GOOGLE_FONTS}/ofl/barlowcondensed/BarlowCondensed-Bold.ttf`,
    sha256: 'e476562ec9c1e16cf16475895b511f08c804f438cc9a9f80a44ea50a0eeb5b65',
  },
  {
    out: 'fonts/jetbrains-mono/jetbrains-mono-500.woff2',
    url: `${JETBRAINS_MONO}/JetBrainsMono-Medium.ttf`,
    sha256: '31c92d01a8a08528b718a43addf0ad3df0af2ca4b7b3290a452f70f358e14d3d',
  },
  {
    out: 'fonts/jetbrains-mono/jetbrains-mono-700.woff2',
    url: `${JETBRAINS_MONO}/JetBrainsMono-Bold.ttf`,
    sha256: '5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb',
  },
  ...[400, 600, 700].map((wght) => ({
    out: `fonts/inter/inter-${wght}.woff2`,
    ...INTER_VF,
    axes: { wght, opsz: INTER_OPSZ },
  })),
];
