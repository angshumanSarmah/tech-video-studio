import type { CSSProperties, ReactNode } from 'react';
import {
  accentFor,
  checkAccentContrast,
  resolveAccent,
  safeAreas,
  SEMANTIC_COLOURS,
  semanticTint,
  textCss,
  tintFor,
  TEXT_STYLES,
  type Rect,
  type TextStyleName,
  type Theme,
} from '../theme/index.ts';

export type SampleAccent = { label: string; colour: string };

type Props = { theme: Theme };

const row = (gap: number): CSSProperties => ({ display: 'flex', gap, alignItems: 'flex-start' });

export function Section({
  theme,
  title,
  children,
}: Props & { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs }}>
      <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>{title}</div>
      {children}
    </section>
  );
}

function Caption({ theme, children }: Props & { children: ReactNode }) {
  return (
    <div
      style={{
        ...textCss(theme, 'label'),
        fontSize: 16,
        color: theme.colours.ink.faint,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
}

export function SemanticSwatches({ theme }: Props) {
  return (
    <div style={row(theme.space.md)}>
      {SEMANTIC_COLOURS.map((name) => {
        const tint = semanticTint(theme, name);
        return (
          <div key={name} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                height: 72,
                borderRadius: theme.radius.md,
                background: tint.base,
                boxShadow: tint.glowShadow,
              }}
            />
            <div
              style={{
                height: 36,
                borderRadius: theme.radius.sm,
                background: tint.soft,
                border: `${theme.stroke.thin}px solid ${tint.border}`,
              }}
            />
            <div style={{ ...textCss(theme, 'label'), color: tint.base }}>{name}</div>
            <Caption theme={theme}>{tint.base}</Caption>
          </div>
        );
      })}
    </div>
  );
}

export function SurfaceSwatches({ theme }: Props) {
  const { colours } = theme;
  const swatches: [string, string][] = [
    ['background', colours.background],
    ['vignette', colours.vignette],
    ['surface', colours.surface],
    ['raised', colours.surfaceRaised],
    ['line', colours.line],
    ['ink', colours.ink.primary],
    ['ink muted', colours.ink.muted],
    ['ink faint', colours.ink.faint],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: theme.space.sm }}>
      {swatches.map(([name, hex]) => (
        <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              height: 40,
              borderRadius: theme.radius.sm,
              background: hex,
              border: `${theme.stroke.hairline}px solid ${colours.line}`,
            }}
          />
          <Caption theme={theme}>{name}</Caption>
        </div>
      ))}
    </div>
  );
}

export function AccentSamples({ theme, accents }: Props & { accents: SampleAccent[] }) {
  const all = [...accents, { label: 'FALLBACK', colour: theme.colours.fallbackAccent }];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.sm }}>
      {all.map(({ label, colour }) => {
        const stored = resolveAccent(theme, colour);
        const tint = tintFor(theme, accentFor(theme, stored));
        const contrast = checkAccentContrast(theme, tint.base);
        const adjusted = tint.base !== stored;
        return (
          <div key={label} style={{ ...row(theme.space.sm), alignItems: 'center' }}>
            <div
              style={{
                ...textCss(theme, 'tag'),
                fontSize: 24,
                whiteSpace: 'nowrap',
                color: tint.base,
                textShadow: tint.glowShadow,
                padding: `10px ${theme.space.sm}px`,
                borderRadius: theme.radius.sm,
                background: tint.soft,
                border: `${theme.stroke.thin}px solid ${tint.border}`,
              }}
            >
              {label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {adjusted ? (
                <>
                  <Caption theme={theme}>
                    {tint.base} {contrast.ratio.toFixed(1)}:1 {contrast.ok ? '✓' : '✗'}
                  </Caption>
                  <Caption theme={theme}>
                    ← {stored} {checkAccentContrast(theme, stored).ratio.toFixed(1)}:1
                  </Caption>
                </>
              ) : (
                <>
                  <Caption theme={theme}>{tint.base}</Caption>
                  <Caption theme={theme}>
                    {contrast.ratio.toFixed(1)}:1 {contrast.ok ? '✓' : '✗ low contrast'}
                  </Caption>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const TYPE_SAMPLES: Record<TextStyleName, string> = {
  headline: 'Cache = fast copy',
  title: 'The hot key',
  chapter: '— 2 · Why does it miss?',
  body: 'Reads hit memory, not disk.',
  subtitle: 'Most reads never hit disk',
  metric: '1,00,000',
  tag: 'p99 · 4 ms',
  label: 'Node · primary',
  hud: 'Step 3/7 · Invalidate',
  footnote: 'Source: vendor benchmark, 2025',
  data: 'SET user:42 "online"',
};

export function TypeSamples({ theme, accent }: Props & { accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs }}>
      {TEXT_STYLES.map((name) => {
        const style = theme.text[name];
        return (
          <div key={name} style={{ ...row(theme.space.md), alignItems: 'baseline' }}>
            <div
              style={{
                ...textCss(theme, name),
                flex: 1,
                color: theme.colours.ink.primary,
                whiteSpace: 'nowrap',
              }}
            >
              {name === 'subtitle' ? (
                <Karaoke text={TYPE_SAMPLES[name]} accent={accent} />
              ) : (
                TYPE_SAMPLES[name]
              )}
            </div>
            <Caption theme={theme}>
              {name} · {style.font} {style.size}/{style.weight}
            </Caption>
          </div>
        );
      })}
    </div>
  );
}

/** Highlights the third word in the accent, as the karaoke subtitles will. */
function Karaoke({ text, accent }: { text: string; accent: string }) {
  return text.split(' ').map((word, i) => (
    <span key={i} style={i === 2 ? { color: accent } : undefined}>
      {i > 0 ? ' ' : ''}
      {word}
    </span>
  ));
}

const TAG_SAMPLES: [(typeof SEMANTIC_COLOURS)[number], string][] = [
  ['neutral', 'LOAD BALANCER'],
  ['focus', 'YOUR CELL'],
  ['ok', '200 OK'],
  ['problem', '429 · TOO MANY'],
  ['concept', 'CACHE HIT'],
];

export function TagSamples({ theme }: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space.sm }}>
      {TAG_SAMPLES.map(([semantic, text]) => {
        const tint = semanticTint(theme, semantic);
        return (
          <div
            key={semantic}
            style={{
              ...textCss(theme, 'tag'),
              color: tint.base,
              padding: `14px ${theme.space.md}px`,
              borderRadius: theme.radius.sm,
              background: tint.soft,
              border: `${theme.stroke.thin}px solid ${tint.border}`,
              boxShadow: tint.glowShadow,
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}

export function StrokeAndRadiusSamples({ theme }: Props) {
  const tint = semanticTint(theme, 'concept');
  const strokes = Object.entries(theme.stroke);
  const radii = Object.entries(theme.radius);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.sm }}>
      {strokes.map(([name, width]) => (
        <div key={name} style={{ ...row(theme.space.sm), alignItems: 'center' }}>
          <svg width={300} height={16} style={{ filter: tint.glowFilter, overflow: 'visible' }}>
            <line x1={0} y1={8} x2={300} y2={8} stroke={tint.base} strokeWidth={width} />
          </svg>
          <Caption theme={theme}>
            {name} {width}px
          </Caption>
        </div>
      ))}
      <div style={row(theme.space.sm)}>
        {radii.map(([name, radius]) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                width: 72,
                height: 48,
                borderRadius: radius,
                background: theme.colours.surfaceRaised,
                border: `${theme.stroke.thin}px solid ${theme.colours.line}`,
              }}
            />
            <Caption theme={theme}>{name}</Caption>
          </div>
        ))}
      </div>
      <div style={{ ...row(theme.space.sm), alignItems: 'flex-end' }}>
        {Object.entries(theme.space).map(([name, size]) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ width: size, height: size, background: theme.colours.line }} />
            <Caption theme={theme}>
              {name} {size}
            </Caption>
          </div>
        ))}
      </div>
    </div>
  );
}

const DIAGRAM_SCALE = 0.17;

export function SafeAreaDiagram({ theme }: Props) {
  const areas = safeAreas(theme);
  const { semantic, ink, line } = theme.colours;
  const box = (rect: Rect, colour: string, fill: boolean, key?: string) => (
    <rect
      key={key}
      x={rect.x * DIAGRAM_SCALE}
      y={rect.y * DIAGRAM_SCALE}
      width={rect.width * DIAGRAM_SCALE}
      height={rect.height * DIAGRAM_SCALE}
      fill={fill ? colour : 'none'}
      fillOpacity={0.18}
      stroke={colour}
      strokeWidth={1.5}
      strokeDasharray={fill ? '4 3' : undefined}
    />
  );
  const legend: [string, string][] = [
    ['platform ui', ink.muted],
    ['avoid zone', semantic.problem],
    ['hud band', semantic.focus],
    ['stage', semantic.concept],
    ['subtitle band', semantic.ok],
  ];
  return (
    <div style={row(theme.space.md)}>
      <svg
        width={areas.canvas.width * DIAGRAM_SCALE}
        height={areas.canvas.height * DIAGRAM_SCALE}
        style={{ background: theme.colours.surface, outline: `1px solid ${line}` }}
      >
        {areas.exclusionZones.map((z) => box(z, ink.muted, false, z.id))}
        {box(areas.hudBand, semantic.focus, true)}
        {box(areas.stage, semantic.concept, true)}
        {box(areas.subtitleBand, semantic.ok, true)}
        {areas.avoidZones.map((z) => box(z, semantic.problem, true, z.id))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {legend.map(([name, colour]) => (
          <div key={name} style={{ ...textCss(theme, 'label'), fontSize: 18, color: colour }}>
            {name}
          </div>
        ))}
        <Caption theme={theme}>
          stage {areas.stage.width}×{areas.stage.height}
        </Caption>
      </div>
    </div>
  );
}
