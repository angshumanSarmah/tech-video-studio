import {
  fontStack,
  withAlpha,
  type Platform,
  type Rect,
  type SafeAreas,
  type Theme,
  type Zone,
} from '../theme/index.ts';

const LABEL_SIZE = 18;
/** Approximate advance of the mono font, used to size label backgrounds. */
const MONO_ADVANCE = 0.6;
const RULER_STEP = 100;

export type Anchor = 'top-left' | 'bottom-right';

export function platformColour(theme: Theme, platform: Platform): string {
  return platform === 'shorts' ? theme.colours.semantic.problem : theme.colours.semantic.focus;
}

export function describeRect(r: Rect): string {
  return `${r.x},${r.y} ${r.width}×${r.height}`;
}

export function RulerGrid({ theme }: { theme: Theme }) {
  const { width, height } = theme.canvas;
  const line = withAlpha(theme.colours.ink.primary, 0.18);
  const text = theme.colours.ink.muted;
  const xs = steps(width);
  const ys = steps(height);
  return (
    <g fontFamily={fontStack(theme, 'mono')} fontSize={14} fill={text}>
      {xs.map((x) => (
        <g key={`x${x}`}>
          <line x1={x} y1={0} x2={x} y2={height} stroke={line} strokeWidth={1} />
          <text x={x + 4} y={height - 6}>
            {x}
          </text>
        </g>
      ))}
      {ys.map((y) => (
        <g key={`y${y}`}>
          <line x1={0} y1={y} x2={width} y2={y} stroke={line} strokeWidth={1} />
          <text x={width - 6} y={y - 4} textAnchor="end">
            {y}
          </text>
        </g>
      ))}
    </g>
  );
}

function steps(max: number): number[] {
  return Array.from({ length: Math.floor((max - 1) / RULER_STEP) }, (_, i) => (i + 1) * RULER_STEP);
}

type ZoneProps = { theme: Theme; rect: Rect; colour: string; dashed?: boolean; fillAlpha?: number };

export function ZoneBox({ rect, colour, dashed = false, fillAlpha = 0.12 }: ZoneProps) {
  return (
    <rect
      {...rect}
      fill={withAlpha(colour, fillAlpha)}
      stroke={colour}
      strokeWidth={3}
      strokeDasharray={dashed ? '14 8' : undefined}
    />
  );
}

/** A label with a dark plate behind it so it stays legible over a screenshot. */
export function Label({
  theme,
  rect,
  colour,
  text,
  anchor,
}: {
  theme: Theme;
  rect: Rect;
  colour: string;
  text: string;
  anchor: Anchor;
}) {
  const pad = 6;
  const w = text.length * LABEL_SIZE * MONO_ADVANCE + pad * 2;
  const h = LABEL_SIZE + pad * 2;
  const preferredX = anchor === 'top-left' ? rect.x + 4 : rect.x + rect.width - w - 4;
  // Keep narrow zones' labels on the canvas.
  const x = Math.max(4, Math.min(preferredX, theme.canvas.width - w - 4));
  const y = anchor === 'top-left' ? rect.y + 4 : rect.y + rect.height - h - 4;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill={withAlpha(theme.colours.vignette, 0.85)}
      />
      <text
        x={x + pad}
        y={y + pad + LABEL_SIZE * 0.82}
        fontFamily={fontStack(theme, 'mono')}
        fontSize={LABEL_SIZE}
        fontWeight={700}
        fill={colour}
      >
        {text}
      </text>
    </g>
  );
}

/** Shorts labels sit top-left and Reels labels bottom-right, so overlapping zones stay readable. */
export function PlatformZones({
  theme,
  zones,
  platform,
  dim,
}: {
  theme: Theme;
  zones: Zone[];
  platform: Platform;
  dim: boolean;
}) {
  const colour = platformColour(theme, platform);
  const anchor: Anchor = platform === 'shorts' ? 'top-left' : 'bottom-right';
  const own = zones.filter((z) => z.id.startsWith(`${platform}.`));
  return (
    <g opacity={dim ? 0.35 : 1}>
      {own.map((z) => (
        <ZoneBox key={z.id} theme={theme} rect={z} colour={colour} />
      ))}
      {own.map((z) => (
        <Label
          key={z.id}
          theme={theme}
          rect={z}
          colour={colour}
          anchor={anchor}
          text={`${z.id} ${describeRect(z)}`}
        />
      ))}
    </g>
  );
}

export function DerivedAreas({ theme, areas }: { theme: Theme; areas: SafeAreas }) {
  const { semantic } = theme.colours;
  const bands: [string, Rect, string][] = [
    ['hud band', areas.hudBand, semantic.neutral],
    ['stage', areas.stage, semantic.concept],
    ['subtitle band', areas.subtitleBand, semantic.ok],
  ];
  return (
    <g>
      <defs>
        <pattern id="avoid-hatch" width={16} height={16} patternUnits="userSpaceOnUse">
          <path d="M0 16 L16 0" stroke={semantic.problem} strokeWidth={3} />
        </pattern>
      </defs>
      {bands.map(([name, rect, colour]) => (
        <ZoneBox key={name} theme={theme} rect={rect} colour={colour} dashed fillAlpha={0.06} />
      ))}
      {areas.avoidZones.map((z) => (
        <rect key={z.id} {...z} fill="url(#avoid-hatch)" opacity={0.6} />
      ))}
      {bands.map(([name, rect, colour]) => (
        <Label
          key={name}
          theme={theme}
          rect={rect}
          colour={colour}
          anchor="top-left"
          text={`${name} ${describeRect(rect)}`}
        />
      ))}
      {areas.avoidZones.map((z) => (
        <Label
          key={z.id}
          theme={theme}
          rect={z}
          colour={semantic.problem}
          anchor="bottom-right"
          text={`avoid ${z.width}×${z.height}`}
        />
      ))}
    </g>
  );
}
