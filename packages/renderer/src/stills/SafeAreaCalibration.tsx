import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Background } from '../background/Background.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { DEFAULT_THEME_ID, getTheme, PLATFORMS, safeAreas, type Platform } from '../theme/index.ts';
import { DerivedAreas, PlatformZones, RulerGrid } from './safe-area-parts.tsx';

export type SafeAreaCalibrationProps = {
  themeId: string;
  /** Platform being checked; the other platform's zones are dimmed. Null shows both equally. */
  platform: Platform | null;
  /** Screenshot under `public/`, cropped to the 9:16 video frame. Null draws the theme background. */
  screenshot: string | null;
};

export const safeAreaCalibrationDefaults: SafeAreaCalibrationProps = {
  themeId: DEFAULT_THEME_ID,
  platform: null,
  screenshot: null,
};

/** 1:1 overlay of every exclusion zone and the derived safe areas, for calibrating the zones. */
export function SafeAreaCalibration({ themeId, platform, screenshot }: SafeAreaCalibrationProps) {
  const theme = getTheme(themeId);
  loadThemeFonts(theme);
  const areas = safeAreas(theme);
  const { width, height } = theme.canvas;
  return (
    <AbsoluteFill>
      {screenshot ? (
        <Img src={staticFile(screenshot)} style={{ width, height, objectFit: 'fill' }} />
      ) : (
        <Background theme={theme} />
      )}
      <AbsoluteFill>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <RulerGrid theme={theme} />
          {PLATFORMS.map((p) => (
            <PlatformZones
              key={p}
              theme={theme}
              zones={areas.exclusionZones}
              platform={p}
              dim={platform !== null && platform !== p}
            />
          ))}
          <DerivedAreas theme={theme} areas={areas} />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
