import { Composition, Still } from 'remotion';
import {
  fixtureChannelHandle,
  fixtureSeries,
  insetRevealBoardSpec,
  layoutModesBoardCardSpec,
  layoutModesBoardSpec,
  patternDecisionBoardSpec,
  patternFlowBoardSpec,
  primitivesBoardSpec,
  rateLimiterSpec,
  spatialFlowBoardSpec,
} from '../fixtures/index.ts';
import { BeatFromSpec } from './compositions/BeatFromSpec.tsx';
import { calculateBeatMetadata, calculateVideoMetadata } from './compositions/metadata.ts';
import type { BeatFromSpecProps, VideoFromSpecProps } from './compositions/props.ts';
import { VideoFromSpec } from './compositions/VideoFromSpec.tsx';
import { getTheme } from './theme/index.ts';
import { PatternSheet, patternSheetDefaults } from './stills/PatternSheet.tsx';
import { PrimitiveSheet, primitiveSheetDefaults } from './stills/PrimitiveSheet.tsx';
import { SafeAreaCalibration, safeAreaCalibrationDefaults } from './stills/SafeAreaCalibration.tsx';
import { ThemeSwatchBoard, themeSwatchBoardDefaults } from './stills/ThemeSwatchBoard.tsx';

const { canvas } = getTheme(themeSwatchBoardDefaults.themeId);

/** Final preset; the render service passes 15 for drafts (scaled down to 540×960). */
const FINAL_FPS = 30;

const videoDefaults: VideoFromSpecProps = {
  spec: rateLimiterSpec,
  series: fixtureSeries,
  audioSrc: null,
  channelHandle: fixtureChannelHandle,
  fps: FINAL_FPS,
};

const beatDefaults: BeatFromSpecProps = { ...videoDefaults, beatId: 'bucket-empty' };

const boardDefaults: VideoFromSpecProps = { ...videoDefaults, spec: primitivesBoardSpec };

const spatialFlowDefaults: VideoFromSpecProps = { ...videoDefaults, spec: spatialFlowBoardSpec };

const insetRevealDefaults: VideoFromSpecProps = { ...videoDefaults, spec: insetRevealBoardSpec };

const patternFlowDefaults: VideoFromSpecProps = { ...videoDefaults, spec: patternFlowBoardSpec };

const patternDecisionDefaults: VideoFromSpecProps = {
  ...videoDefaults,
  spec: patternDecisionBoardSpec,
};

const layoutModesDefaults: VideoFromSpecProps = { ...videoDefaults, spec: layoutModesBoardSpec };

const layoutModesCardDefaults: VideoFromSpecProps = {
  ...videoDefaults,
  spec: layoutModesBoardCardSpec,
};

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
      <Composition
        id="LayoutModesBoard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={layoutModesDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="LayoutModesBoardCard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={layoutModesCardDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="PrimitivesBoard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={boardDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="SpatialFlowBoard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={spatialFlowDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="InsetRevealBoard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={insetRevealDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="PatternFlowBoard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={patternFlowDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Composition
        id="PatternDecisionBoard"
        component={VideoFromSpec}
        width={canvas.width}
        height={canvas.height}
        fps={FINAL_FPS}
        durationInFrames={1}
        defaultProps={patternDecisionDefaults}
        calculateMetadata={calculateVideoMetadata}
      />
      <Still
        id="PatternSheet"
        component={PatternSheet}
        width={canvas.width}
        height={canvas.height}
        defaultProps={patternSheetDefaults}
      />
      <Still
        id="PrimitiveSheet"
        component={PrimitiveSheet}
        width={canvas.width}
        height={canvas.height}
        defaultProps={primitiveSheetDefaults}
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
