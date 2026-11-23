import { parseRenderableSpec } from '../src/compositions/metadata.ts';
import type { SeriesProps } from '../src/compositions/props.ts';
import type { RenderableVideoSpec, VideoFormat } from '@explainer-studio/shared';
import goldenRateLimiterJson from './golden/golden-rate-limiter.json';
import goldenStrawberryJson from './golden/golden-strawberry.json';
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

/**
 * Golden fixtures (P1A.13): two complete, hand-authored Shorts with estimated timing, one per
 * series, written the way the agents should write them (no validation or layout warnings in the
 * full format). They are the visual regression set: `test:visual` in the studio renders a still
 * per beat and compares it with the saved image in `apps/studio/golden/<id>/`. Changing one of
 * them changes those images (refresh them with `UPDATE_GOLDEN=1`).
 *
 * - `golden-rate-limiter` (System Design): question chapters, hero metric, tags, counters, a
 *   timer ring, `versus_split`, a `continuesPrevious` chain and `flood_then_funnel`; it ends on a
 *   spec card (one line at `SPEC_CARD_LINE_MAX`, series number 12) and a CTA.
 * - `golden-strawberry` (AI): the step tracker, a token strip built from tags (a placeholder for
 *   the `token_strip` primitive it records in `missingPrimitiveRequests`), a source footnote and
 *   an ending card with only a long CTA.
 *
 * Both end on a closing sentence with no events: the ending card covers it.
 */
export const goldenRateLimiterSpec = parseRenderableSpec(goldenRateLimiterJson);

export const goldenStrawberrySpec = parseRenderableSpec(goldenStrawberryJson);

/** Every fixture spec with scenes, for checks that run over all of them. */
export const allFixtureSpecs = [
  rateLimiterSpec,
  goldenRateLimiterSpec,
  goldenStrawberrySpec,
  ...primitiveBoardSpecs,
  ...patternBoardSpecs,
  layoutModesBoardSpec,
  transitionsBoardSpec,
];

/** Example series data; real values come from the DB `series` row at render time. */
export const fixtureSeries: SeriesProps = { label: 'System Design', accentColour: '#4F8CFF' };

/** Example channel handle; real values come from the DB `channels.handle` at render time. */
export const fixtureChannelHandle = '@explainer.studio';

/** Series of the AI golden fixture (the seeded `ai` series). */
export const aiFixtureSeries: SeriesProps = { label: 'AI', accentColour: '#B07CFF' };

/** A golden fixture: the parsed spec, its raw JSON (for validation checks) and its series. */
export interface GoldenFixture {
  readonly spec: RenderableVideoSpec;
  readonly json: unknown;
  readonly series: SeriesProps;
}

/** The golden fixtures with the series each renders under. */
export const goldenFixtures: readonly GoldenFixture[] = [
  { spec: goldenRateLimiterSpec, json: goldenRateLimiterJson, series: fixtureSeries },
  { spec: goldenStrawberrySpec, json: goldenStrawberryJson, series: aiFixtureSeries },
];
