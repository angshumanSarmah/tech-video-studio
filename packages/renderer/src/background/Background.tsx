import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme/index.ts';
import { gridCss } from './grid.ts';

/** Theme background: base colour, a slowly drifting grid (driven by the frame), and a vignette. */
export function Background({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { background, vignette } = theme.colours;
  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <AbsoluteFill style={gridCss(theme, frame / fps)} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 85% 70% at 50% 45%, transparent 55%, ${vignette} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
}
