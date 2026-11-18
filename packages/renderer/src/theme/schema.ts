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

/** Semantic colours used by tags, headlines and primitive states. */
export const SEMANTIC_COLOURS = ['neutral', 'focus', 'ok', 'problem', 'concept'] as const;
export type SemanticColour = (typeof SEMANTIC_COLOURS)[number];

export const FONT_ROLES = ['display', 'mono', 'sans'] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const TEXT_STYLES = [
  'headline',
  'title',
  'body',
  'subtitle',
  'tag',
  'label',
  'footnote',
] as const;
export type TextStyleName = (typeof TEXT_STYLES)[number];

/** Platforms whose on-screen UI the safe area must avoid. */
export const PLATFORMS = ['shorts', 'reels'] as const;
export type Platform = (typeof PLATFORMS)[number];

const FontFileSchema = z.object({
  weight: z.number().int().min(100).max(900),
  /** Path under the renderer's `public/` directory (loaded with `staticFile`). */
  path: z.string().regex(/^fonts\/[\w.-]+\/[\w.-]+\.woff2$/),
});

const FontSchema = z.object({
  family: z.string().min(1),
  /** CSS fallback stack appended after `family`. */
  fallback: z.string().min(1),
  files: z.array(FontFileSchema).min(1),
});

const TextStyleSchema = z.object({
  font: z.enum(FONT_ROLES),
  size: PxSchema,
  weight: z.number().int().min(100).max(900),
  /** In em. */
  letterSpacing: z.number(),
  lineHeight: z.number().positive(),
  uppercase: z.boolean(),
});

const InsetsSchema = z.object({ top: PxSchema, right: PxSchema, bottom: PxSchema, left: PxSchema });
export type Insets = z.infer<typeof InsetsSchema>;

const scale = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, PxSchema])) as Record<K, typeof PxSchema>);

export const ThemeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
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
  tint: z.object({ softAlpha: AlphaSchema, borderAlpha: AlphaSchema }),
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
  fonts: z.object({ display: FontSchema, mono: FontSchema, sans: FontSchema }),
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
    /** Margins covered by each platform's UI (buttons, captions, progress bar). */
    platforms: z.object(
      Object.fromEntries(PLATFORMS.map((k) => [k, InsetsSchema])) as Record<
        Platform,
        typeof InsetsSchema
      >,
    ),
    /** Height of the top HUD band (top bar, chapter header, step tracker, hero metric). */
    hudBand: PxSchema,
    /** Height of the bottom subtitle band. */
    subtitleBand: PxSchema,
    /** Gap between the stage and each band. */
    gap: PxSchema,
  }),
});

export type Theme = z.infer<typeof ThemeSchema>;
export type ThemeInput = z.input<typeof ThemeSchema>;
