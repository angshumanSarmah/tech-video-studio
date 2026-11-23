import { Freeze } from 'remotion';
import {
  fixtureChannelHandle,
  goldenFixtures,
  withFormat,
  type GoldenFixture,
} from '../../fixtures/index.ts';
import { SpecLayers } from '../compositions/SpecLayers.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { DEFAULT_THEME_ID, getTheme, textCss } from '../theme/index.ts';
import { ENDING_SHEET, endingMoments, endingSheetSize } from './ending-sheet.ts';

export type EndingSheetProps = {
  /** A golden fixture's `meta.id`. */
  fixtureId: string;
  themeId?: string;
};

export const endingSheetDefaults: EndingSheetProps = { fixtureId: 'golden-rate-limiter' };

/** The sheet's frame rate: the final preset's, so moments match the final video. */
export const ENDING_SHEET_FPS = 30;

/**
 * The sheet composition's length: longer than any Short (170 s at 30 fps), so no frozen moment is
 * clamped. Only frame 0 is rendered.
 */
export const ENDING_SHEET_FRAMES = 6000;

const FORMATS = ['full', 'card'] as const;

export function endingFixture(fixtureId: string): GoldenFixture {
  const fixture = goldenFixtures.find((f) => f.spec.meta.id === fixtureId);
  if (!fixture) throw new Error(`Unknown golden fixture "${fixtureId}".`);
  return fixture;
}

/** Size of the `EndingSheet` still for a fixture (its moments, both formats). */
export function endingSheetDimensions(themeId: string | undefined) {
  return endingSheetSize(getTheme(themeId ?? DEFAULT_THEME_ID).canvas, 4, FORMATS.length);
}

/**
 * One row per format (full, card) of a golden fixture's last seconds: just before the ending card
 * enters, mid-draw, settled and the last frame, each the whole video frame (HUD, board, card and
 * subtitles) frozen at that moment and scaled down. `still:ending` writes it to
 * `docs/ending/<fixture>-<theme>.png`.
 */
export function EndingSheet({ fixtureId, themeId }: EndingSheetProps) {
  const theme = getTheme(themeId ?? DEFAULT_THEME_ID);
  loadThemeFonts(theme);
  const { spec, series } = endingFixture(fixtureId);
  const moments = endingMoments(spec, ENDING_SHEET_FPS, series.label);
  const { scale, margin, gap, label } = ENDING_SHEET;
  const panel = { width: theme.canvas.width * scale, height: theme.canvas.height * scale };
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: theme.colours.surfaceRaised,
        padding: margin,
        display: 'flex',
        flexDirection: 'column',
        gap,
      }}
    >
      {FORMATS.map((format) => (
        <div key={format} style={{ display: 'flex', gap }}>
          {moments.map((moment) => (
            <div key={moment.label} style={{ width: panel.width }}>
              <div
                style={{
                  ...textCss(theme, 'hud'),
                  height: label,
                  color: theme.colours.ink.muted,
                }}
              >
                {`${format} · ${moment.label} · ${moment.frame}`}
              </div>
              <div
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  ...panel,
                  outline: `${theme.stroke.hairline}px solid ${theme.colours.line}`,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    ...theme.canvas,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <Freeze frame={moment.frame}>
                    <SpecLayers
                      spec={withFormat(spec, format)}
                      series={series}
                      audioSrc={null}
                      channelHandle={fixtureChannelHandle}
                      themeId={theme.id}
                    />
                  </Freeze>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
