import { AbsoluteFill } from 'remotion';
import { Background } from '../background/Background.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { DEFAULT_THEME_ID, getTheme, resolveAccent, textCss, type Theme } from '../theme/index.ts';
import {
  AccentSamples,
  SafeAreaDiagram,
  Section,
  SemanticSwatches,
  StrokeAndRadiusSamples,
  SurfaceSwatches,
  TagSamples,
  TypeSamples,
  type SampleAccent,
} from './swatch-parts.tsx';

export type ThemeSwatchBoardProps = {
  themeId: string;
  /** Example series accents (real ones come from the DB at render time). */
  accents: SampleAccent[];
};

export const themeSwatchBoardDefaults: ThemeSwatchBoardProps = {
  themeId: DEFAULT_THEME_ID,
  accents: [
    { label: 'SYSTEM DESIGN', colour: '#4F8CFF' },
    { label: 'AI', colour: '#B07CFF' },
  ],
};

/** Reference sheet for a theme: colours, tints, fonts, tags, strokes and safe areas. */
export function ThemeSwatchBoard({ themeId, accents }: ThemeSwatchBoardProps) {
  const theme = getTheme(themeId);
  loadThemeFonts(theme);
  const accent = resolveAccent(theme, accents[0]?.colour);
  return (
    <AbsoluteFill>
      <Background theme={theme} />
      <AbsoluteFill
        style={{
          padding: theme.space.xl,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.space.sm,
          color: theme.colours.ink.primary,
        }}
      >
        <Header theme={theme} />
        <Section theme={theme} title="Semantic colours · base / soft / glow">
          <SemanticSwatches theme={theme} />
        </Section>
        <div style={{ display: 'flex', gap: theme.space.xl }}>
          <div style={{ flex: 1 }}>
            <Section theme={theme} title="Surfaces & ink">
              <SurfaceSwatches theme={theme} />
            </Section>
          </div>
          <div style={{ flex: 1 }}>
            <Section theme={theme} title="Series accents · contrast">
              <AccentSamples theme={theme} accents={accents} />
            </Section>
          </div>
        </div>
        <Section theme={theme} title={`Type · ${fontFamilies(theme)}`}>
          <TypeSamples theme={theme} accent={accent} />
        </Section>
        <Section theme={theme} title="Tags">
          <TagSamples theme={theme} />
        </Section>
        <div style={{ display: 'flex', gap: theme.space.xl }}>
          <div style={{ flex: 1 }}>
            <Section theme={theme} title="Strokes · radius · space">
              <StrokeAndRadiusSamples theme={theme} />
            </Section>
          </div>
          <Section theme={theme} title="Safe areas">
            <SafeAreaDiagram theme={theme} />
          </Section>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function fontFamilies(theme: Theme): string {
  return [...new Set(Object.values(theme.fonts).map((f) => f.family))].join(' / ');
}

function Header({ theme }: { theme: Theme }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs }}>
      <div style={{ ...textCss(theme, 'headline'), color: theme.colours.semantic.focus }}>
        {theme.name}
      </div>
      <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
        theme · {theme.id} · {theme.canvas.width}×{theme.canvas.height}
      </div>
    </div>
  );
}
