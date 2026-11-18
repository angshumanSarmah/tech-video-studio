import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Background } from '../background/Background.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import {
  DEFAULT_THEME_ID,
  getTheme,
  PLATFORMS,
  safeAreas,
  type Platform,
  type Rect,
  type Theme,
} from '../theme/index.ts';
import { DerivedAreas, PlatformZones, RulerGrid } from './safe-area-parts.tsx';

/** The region of the screenshot (in its own pixels) scaled to fill the canvas. */
export type ScreenshotCrop = Rect & { sourceWidth: number; sourceHeight: number };

export type SafeAreaCalibrationProps = {
  themeId: string;
  /** Platform being checked; the other platform's zones are dimmed. Null shows both equally. */
  platform: Platform | null;
  /** Screenshot under `public/`. Null draws the theme background. */
  screenshot: string | null;
  /** Region of the screenshot to show. Null stretches the whole screenshot to the canvas. */
  crop: ScreenshotCrop | null;
};

export const safeAreaCalibrationDefaults: SafeAreaCalibrationProps = {
  themeId: DEFAULT_THEME_ID,
  platform: null,
  screenshot: null,
  crop: null,
};

/** 1:1 overlay of every exclusion zone and the derived safe areas, for calibrating the zones. */
export function SafeAreaCalibration({
  themeId,
  platform,
  screenshot,
  crop,
}: SafeAreaCalibrationProps) {
  const theme = getTheme(themeId);
  loadThemeFonts(theme);
  const areas = safeAreas(theme);
  const { width, height } = theme.canvas;
  return (
    <AbsoluteFill>
      {screenshot ? (
        <Screenshot theme={theme} src={screenshot} crop={crop} />
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

/** The screenshot scaled so that `crop` exactly fills the canvas. */
function Screenshot({
  theme,
  src,
  crop,
}: {
  theme: Theme;
  src: string;
  crop: ScreenshotCrop | null;
}) {
  const { width, height } = theme.canvas;
  if (!crop) {
    return <Img src={staticFile(src)} style={{ width, height, objectFit: 'fill' }} />;
  }
  const sx = width / crop.width;
  const sy = height / crop.height;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={staticFile(src)}
        style={{
          position: 'absolute',
          left: -crop.x * sx,
          top: -crop.y * sy,
          width: crop.sourceWidth * sx,
          height: crop.sourceHeight * sy,
          maxWidth: 'none',
        }}
      />
    </AbsoluteFill>
  );
}
