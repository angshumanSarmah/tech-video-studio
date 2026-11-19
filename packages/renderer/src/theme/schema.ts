import { z } from 'zod';

/**
 * Theme schema. A theme is pure data (no React) so the layout engine, the studio's token generator
 * and the Settings UI can read it. Sizes are pixels on the theme's canvas.
 */

export const HexColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected a 6-digit hex colour such as #1a2b3c');
export type HexColour = z.infer<typeof HexColourSchema>;

const PxSchema = z.number().nonnegative();
const AlphaSchema = z.number().min(0).max(1);

/**
 * How `highlight` and `pulse` show: `glow` adds the theme's glow; `mark` draws a highlighter
 * swipe behind the element (focus fill), bolder outlines, and an ink ripple on pulse.
 */
export const EMPHASIS_STYLES = ['glow', 'mark'] as const;
export type EmphasisStyle = (typeof EMPHASIS_STYLES)[number];

/**
 * How the HUD top band is drawn (same HUD data and spec toggles either way): `bar` is the open
 * top bar, step tracker and hero metric pill; `title-block` draws them as an engineering drawing's
 * title block (a ruled strip of cells, SHEET n/N) with the hero metric as a dimension.
 */
export const HUD_STYLES = ['bar', 'title-block'] as const;
export type HudStyle = (typeof HUD_STYLES)[number];

/** Semantic colours used by tags, headlines and primitive states. */
export const SEMANTIC_COLOURS = ['neutral', 'focus', 'ok', 'problem', 'concept'] as const;
export type SemanticColour = (typeof SEMANTIC_COLOURS)[number];

export const FONT_ROLES = ['display', 'mono', 'sans'] as const;
export type FontRole = (typeof FONT_ROLES)[number];

/**
 * Every bundled face a theme may have: the roles, plus an optional `glyphFallback` face that is
 * never a role itself and only supplies glyphs the role fonts lack (e.g. Inter for ✓ ✗ and ₹).
 */
export const BUNDLED_FONTS = [...FONT_ROLES, 'glyphFallback'] as const;
export type BundledFontKey = (typeof BUNDLED_FONTS)[number];

export const TEXT_STYLES = [
  'headline',
  'metric',
  'title',
  'chapter',
  'body',
  'subtitle',
  'tag',
  'label',
  'hud',
  'footnote',
  'data',
] as const;
export type TextStyleName = (typeof TEXT_STYLES)[number];

/** Platforms whose on-screen UI the safe area must avoid. */
export const PLATFORMS = ['shorts', 'reels'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Where each platform's UI covers the video. */
export const PLATFORM_ZONES = ['topBar', 'actions', 'bottomInfo'] as const;
export type PlatformZone = (typeof PLATFORM_ZONES)[number];

const FontFileSchema = z.object({
  weight: z.number().int().min(100).max(900),
  /** Path under the renderer's `public/` directory (loaded with `staticFile`). */
  path: z.string().regex(/^fonts\/[\w.-]+\/[\w.-]+\.woff2$/),
});

/** A bundled font family and its files. */
const FontFaceSchema = z.object({
  family: z.string().min(1),
  files: z.array(FontFileSchema).min(1),
});

const FontSchema = FontFaceSchema.extend({
  /** CSS fallback stack appended after `family`. */
  fallback: z.string().min(1),
  /**
   * Average advance per character in em, with headroom over measured capitals, for size hints
   * (`approxTextWidth`). Rough by design; the layout engine may measure real glyphs later.
   */
  advanceEm: z.number().positive(),
  /**
   * Other bundled fonts (roles or `glyphFallback`) to try before `fallback`, for glyphs this font
   * lacks (e.g. arrows). `font-coverage.test.ts` checks each role's stack covers
   * `REQUIRED_CODE_POINTS`.
   */
  bundledFallbacks: z.array(z.enum(BUNDLED_FONTS)).default([]),
});

/** A fill drawn instead of the semantic colour's own soft tint, e.g. a highlighter behind ink. */
const FillSchema = z.object({ colour: HexColourSchema, alpha: AlphaSchema });

const TextStyleSchema = z.object({
  font: z.enum(FONT_ROLES),
  size: PxSchema,
  weight: z.number().int().min(100).max(900),
  /** In em. */
  letterSpacing: z.number(),
  lineHeight: z.number().positive(),
  uppercase: z.boolean(),
});

/** A rectangle in canvas pixels. */
export const RectSchema = z.object({
  x: PxSchema,
  y: PxSchema,
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Rect = z.infer<typeof RectSchema>;

const PlatformZonesSchema = z.object(
  Object.fromEntries(PLATFORM_ZONES.map((k) => [k, RectSchema])) as Record<
    PlatformZone,
    typeof RectSchema
  >,
);

const scale = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, PxSchema])) as Record<K, typeof PxSchema>);

function isNumberLocale(tag: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0;
  } catch {
    return false;
  }
}

export const ThemeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    description: z.string().min(1),
    canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    /** BCP 47 locale for numbers on screen (counters, stats), e.g. `en-IN` groups as 1,00,000. */
    numberLocale: z
      .string()
      .refine((tag) => isNumberLocale(tag), { message: 'Unsupported number locale.' }),
    colours: z.object({
      background: HexColourSchema,
      /** Edge colour of the radial vignette over the background. */
      vignette: HexColourSchema,
      surface: HexColourSchema,
      surfaceRaised: HexColourSchema,
      line: HexColourSchema,
      ink: z.object({ primary: HexColourSchema, muted: HexColourSchema, faint: HexColourSchema }),
      semantic: z.object(
        Object.fromEntries(SEMANTIC_COLOURS.map((k) => [k, HexColourSchema])) as Record<
          SemanticColour,
          typeof HexColourSchema
        >,
      ),
      /** Used when a series has no accent or an invalid one. Series accents themselves are data. */
      fallbackAccent: HexColourSchema,
    }),
    /** How any colour (semantic or series accent) is applied as fills and glows. */
    tint: z.object({
      softAlpha: AlphaSchema,
      borderAlpha: AlphaSchema,
      /**
       * Per-semantic override of the soft fill. Without one, a semantic fills with its own colour
       * at `softAlpha`. Lets a light theme keep a semantic's text and strokes dark (its colour) while
       * filling behind them with something else (focus as a yellow highlighter).
       */
      fills: z
        .object(
          Object.fromEntries(SEMANTIC_COLOURS.map((k) => [k, FillSchema.optional()])) as Record<
            SemanticColour,
            z.ZodOptional<typeof FillSchema>
          >,
        )
        .default({}),
    }),
    /** How emphasis (`highlight`, `pulse`) is drawn; see `src/emphasis`. */
    emphasis: z.object({ style: z.enum(EMPHASIS_STYLES) }),
    /** How the HUD top band is drawn; see `src/hud`. */
    hud: z.object({ style: z.enum(HUD_STYLES) }),
    glow: z.object({
      innerBlur: PxSchema,
      innerAlpha: AlphaSchema,
      outerBlur: PxSchema,
      outerAlpha: AlphaSchema,
    }),
    minimumContrast: z.object({
      /** Text, including accent-coloured labels and karaoke highlights. */
      text: z.number().min(1),
      /** Strokes, icons and other non-text graphics. */
      graphic: z.number().min(1),
    }),
    grid: z.object({
      minorCell: z.number().positive(),
      majorEvery: z.number().int().min(1),
      colour: HexColourSchema,
      minorAlpha: AlphaSchema,
      majorAlpha: AlphaSchema,
      /** Background drift in px per second; keep it subtle. */
      drift: z.object({ x: z.number(), y: z.number() }),
    }),
    fonts: z.object({
      display: FontSchema,
      mono: FontSchema,
      sans: FontSchema,
      glyphFallback: FontFaceSchema.optional(),
    }),
    text: z.object(
      Object.fromEntries(TEXT_STYLES.map((k) => [k, TextStyleSchema])) as Record<
        TextStyleName,
        typeof TextStyleSchema
      >,
    ),
    space: scale(['xs', 'sm', 'md', 'lg', 'xl', 'xxl']),
    radius: scale(['sm', 'md', 'lg', 'pill']),
    stroke: scale(['hairline', 'thin', 'regular', 'bold']),
    safeArea: z.object({
      /**
       * Exclusion zones per platform: rectangles in canvas coordinates where the platform's UI
       * covers the video. `topBar` touches the top edge, `bottomInfo` the bottom edge; `actions` is
       * the button column on the side. Calibrate with `calibrate:safe-area`.
       */
      platforms: z.object(
        Object.fromEntries(PLATFORMS.map((k) => [k, PlatformZonesSchema])) as Record<
          Platform,
          typeof PlatformZonesSchema
        >,
      ),
      /** Horizontal margin on both sides, so content stays centred. */
      gutter: PxSchema,
      /** Height of the top HUD band (top bar, chapter header, step tracker, hero metric). */
      hudBand: z.number().positive(),
      /** Height of the headline band at the top of the stage, on beats that show a headline. */
      headlineBand: z.number().positive(),
      /** Height of the bottom subtitle band. */
      subtitleBand: z.number().positive(),
    }),
  })
  .superRefine((theme, ctx) => {
    for (const role of FONT_ROLES) {
      const { bundledFallbacks } = theme.fonts[role];
      if (bundledFallbacks.includes(role)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fonts', role, 'bundledFallbacks'],
          message: `a font cannot fall back to its own role "${role}"`,
        });
      }
      if (bundledFallbacks.includes('glyphFallback') && !theme.fonts.glyphFallback) {
        ctx.addIssue({
          code: 'custom',
          path: ['fonts', role, 'bundledFallbacks'],
          message: 'falls back to "glyphFallback", but the theme has no fonts.glyphFallback',
        });
      }
    }
    const { width, height } = theme.canvas;
    for (const platform of PLATFORMS) {
      for (const zone of PLATFORM_ZONES) {
        const r = theme.safeArea.platforms[platform][zone];
        if (r.x + r.width > width || r.y + r.height > height) {
          ctx.addIssue({
            code: 'custom',
            path: ['safeArea', 'platforms', platform, zone],
            message: `zone must lie inside the ${width}x${height} canvas`,
          });
        }
      }
    }
  });

export type Theme = z.infer<typeof ThemeSchema>;
export type ThemeInput = z.input<typeof ThemeSchema>;
