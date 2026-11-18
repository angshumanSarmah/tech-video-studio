import { Composition, Still } from 'remotion';
import { fixtureSeries, rateLimiterSpec } from '../fixtures/index.ts';
import { BeatFromSpec } from './compositions/BeatFromSpec.tsx';
import { calculateBeatMetadata, calculateVideoMetadata } from './compositions/metadata.ts';
import type { BeatFromSpecProps, VideoFromSpecProps } from './compositions/props.ts';
import { VideoFromSpec } from './compositions/VideoFromSpec.tsx';
import { getTheme } from './theme/index.ts';
import { SafeAreaCalibration, safeAreaCalibrationDefaults } from './stills/SafeAreaCalibration.tsx';
import { ThemeSwatchBoard, themeSwatchBoardDefaults } from './stills/ThemeSwatchBoard.tsx';

const { canvas } = getTheme(themeSwatchBoardDefaults.themeId);

/** Final preset; the render service passes 15 for drafts (scaled down to 540×960). */
const FINAL_FPS = 30;

const videoDefaults: VideoFromSpecProps = {
  spec: rateLimiterSpec,
  series: fixtureSeries,
  audioSrc: null,
  fps: FINAL_FPS,
};

const beatDefaults: BeatFromSpecProps = { ...videoDefaults, beatId: 'bucket-empty' };

/** Remotion root. Duration and fps of the spec compositions come from `calculateMetadata`. */
export function Root() {
  return (
    <>
      <Composition
        id="VideoFromSpec"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={videoDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="BeatFromSpec"
        component={BeatFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={beatDefaults}
        calculateMetadata={calculateBeatMetadata}
      />
      <Still
        id="ThemeSwatchBoard"
        component={ThemeSwatchBoard}
        width={canvas.width}
        height={canvas.height}
        defaultProps={themeSwatchBoardDefaults}
      />
      <Still
        id="SafeAreaCalibration"
        component={SafeAreaCalibration}
        width={canvas.width}
        height={canvas.height}
        defaultProps={safeAreaCalibrationDefaults}
      />
    </>
  );
}
