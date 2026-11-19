import { parseRenderableSpec } from '../src/compositions/metadata.ts';
import type { SeriesProps } from '../src/compositions/props.ts';
import type { RenderableVideoSpec, VideoFormat } from '@explainer-studio/shared';
import insetRevealBoardJson from './inset-reveal-board.json';
import layoutModesBoardJson from './layout-modes-board.json';
import patternDecisionBoardJson from './pattern-decision-board.json';
import patternFlowBoardJson from './pattern-flow-board.json';
import primitivesBoardJson from './primitives-board.json';
import rateLimiterJson from './rate-limiter.json';
import spatialFlowBoardJson from './spatial-flow-board.json';
import transitionsBoardJson from './transitions-board.json';

/**
 * Renderable fixture without a timing layer, so Studio previews it with estimated timing (as a
 * spec looks before TTS). Validated at load: an invalid fixture fails loudly. Its devices resolve
 * the HUD to the step tracker only; `hud.chapterHeader: true` overrides that so Studio shows
 * every HUD part.
 */
export const rateLimiterSpec = parseRenderableSpec(rateLimiterJson);

/**
 * Primitive boards: one beat per registered primitive (beat and element id: the primitive id with
 * `-` for `_`), each showing every event it supports (part events included), anchored to its
 * narration. Each board is a valid Short (45–90 s), so primitives are split across boards. Studio
 * previews them as `PrimitivesBoard`, `SpatialFlowBoard` and `InsetRevealBoard`; `PrimitiveSheet` stills sample them
 * for `docs/primitives/`.
 */
export const primitivesBoardSpec = parseRenderableSpec(primitivesBoardJson);

/** Batch 2 (P1A.7): spatial and flow primitives. */
export const spatialFlowBoardSpec = parseRenderableSpec(spatialFlowBoardJson);

/**
 * Batch 3 (P1A.7b): inset and reveal primitives. Its callout beat carries a beat `source`, so the
 * board also shows the source footnote.
 */
export const insetRevealBoardSpec = parseRenderableSpec(insetRevealBoardJson);

/** Every primitive board, in registry order. */
export const primitiveBoardSpecs = [
  primitivesBoardSpec,
  spatialFlowBoardSpec,
  insetRevealBoardSpec,
];

/**
 * Pattern boards: one beat per registered pattern (beat and instance id: the pattern id with `-`
 * for `_`), with every narration anchor in its params. Scenes set no `layoutMode`, so each beat
 * takes its pattern's. Each board is a valid Short. Studio previews them as `PatternFlowBoard` and `PatternDecisionBoard`;
 * `PatternSheet` stills sample them for `docs/patterns/`.
 */
export const patternFlowBoardSpec = parseRenderableSpec(patternFlowBoardJson);

/** Batch 2: search, decision and leadership patterns (P1A.7b primitives). */
export const patternDecisionBoardSpec = parseRenderableSpec(patternDecisionBoardJson);

/** Every pattern board, in registry order. */
export const patternBoardSpecs = [patternFlowBoardSpec, patternDecisionBoardSpec];

/** The same spec in another format (the card format's header, window and bands). */
export function withFormat(spec: RenderableVideoSpec, format: VideoFormat): RenderableVideoSpec {
  return { ...spec, meta: { ...spec.meta, format } };
}

/**
 * Layout board (P1A.9): one beat per layout mode, each scene naming its mode, with pins, rings,
 * a bracket, an inset, a sourced beat (footnote) and one `continuesPrevious` chain (the pipeline:
 * positions stay, the camera reframes). Studio previews it as `LayoutModesBoard` and, in the card
 * format, `LayoutModesBoardCard`; `still:layouts` renders `docs/layouts/<mode>-<format>.png`.
 */
export const layoutModesBoardSpec = parseRenderableSpec(layoutModesBoardJson);

export const layoutModesBoardCardSpec = withFormat(layoutModesBoardSpec, 'card');

/**
 * Transitions board (P1A.10): one beat per beat transition (cut, fade, slide, zoom-out, and a
 * semantic zoom from the "Redis server" into its "hash table"), with a focus event mid-beat, a
 * default highlight beside a held one, a scan over parts, a lock and release, and an overlay
 * taking focus. Studio previews it as `TransitionsBoard`.
 */
export const transitionsBoardSpec = parseRenderableSpec(transitionsBoardJson);

/** Every fixture spec with scenes, for checks that run over all of them. */
export const allFixtureSpecs = [
  rateLimiterSpec,
  ...primitiveBoardSpecs,
  ...patternBoardSpecs,
  layoutModesBoardSpec,
  transitionsBoardSpec,
];

/** Example series data; real values come from the DB `series` row at render time. */
export const fixtureSeries: SeriesProps = { label: 'System Design', accentColour: '#4F8CFF' };

/** Example channel handle; real values come from the DB `channels.handle` at render time. */
export const fixtureChannelHandle = '@explainer.studio';
