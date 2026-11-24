// React-free registry API: safe to import from the worker (validation, prompts) and the server.
export * from '../primitives/types.ts';
export * from '../primitives/registry.ts';
export * from '../patterns/types.ts';
export * from '../patterns/registry.ts';
export * from '../layout/modes.ts';
export { formatAreas, type FormatAreas } from '../layout/format.ts';
export { specLayout, specLayoutWarnings, type SpecLayout } from '../layout/spec-layout.ts';
export { TEXT_TRUNCATED } from '../layout/text-fit.ts';
export { hudTextWarnings } from '../hud/hud-text-checks.ts';
export { titleRoomChars } from '../hud/title-room.ts';
export type { HudContext } from '../hud/hud-slots.ts';
// Subtitles (P1B.3): the cues the video draws, for the SRT writer, and their warnings.
export { buildSubtitleCues, type CueWord, type SubtitleCue } from '../subtitles/cues.ts';
export { SUBTITLE_WORD_TOO_WIDE, subtitleWarnings } from '../subtitles/subtitle-checks.ts';
export type { BoardLayout, LayoutWarning, PlacedItem } from '../layout/types.ts';
export * from '../assets/house-svg.ts';
export * from '../assets/library.ts';
export * from '../assets/seed.ts';
export * from '../assets/suggest.ts';
export * from './asset-uses.ts';
export * from './registries.ts';
export * from './validate.ts';
export * from './catalogue.ts';
export * from './prompt-block.ts';
// Render service helpers (P1A.12): cache-key inputs, still key frames and frame spans.
export * from './render-inputs.ts';
export * from './key-frame.ts';
export { beatSettledOffsets } from './settled.ts';
export { beatFrameSpans, secToFrame, totalFrames, type BeatFrameSpan } from '../timing/frames.ts';
export type { BeatFromSpecProps, SeriesProps, VideoFromSpecProps } from '../compositions/props.ts';
// The Generator's checks (P1C.7): asset swaps and the schema leaves the screen checks read.
export * from './asset-swaps.ts';
export * from './schema-leaves.ts';
export { nearIdenticalAsset } from '../assets/near-identical.ts';
export * from './beat-checks.ts';
export * from './screen-checks.ts';
export * from './layer-checks.ts';
export * from './board-state.ts';
export * from './pin-hosts.ts';
// The Curator's code checks (P1C.8): text size after the camera, colour, variety, and all of them together.
export { onScreenTextWarnings, TEXT_TOO_SMALL_ON_SCREEN } from '../layout/on-screen-text.ts';
export * from './colour-checks.ts';
export * from './variety-checks.ts';
export * from './curator-checks.ts';
export * from './board-description.ts';
export * from './term-checks.ts';
