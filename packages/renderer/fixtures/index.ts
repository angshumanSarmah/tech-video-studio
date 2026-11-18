import { parseRenderableSpec } from '../src/compositions/metadata.ts';
import type { SeriesProps } from '../src/compositions/props.ts';
import primitivesBoardJson from './primitives-board.json';
import rateLimiterJson from './rate-limiter.json';

/**
 * Renderable fixture without a timing layer, so Studio previews it with estimated timing (as a
 * spec looks before TTS). Validated at load: an invalid fixture fails loudly. Its devices resolve
 * the HUD to the step tracker only; `hud.chapterHeader: true` overrides that so Studio shows
 * every HUD part.
 */
export const rateLimiterSpec = parseRenderableSpec(rateLimiterJson);

/**
 * One beat per registered primitive (beat and element id: the primitive id with `-` for `_`),
 * each showing every event it supports, anchored to its narration. Studio previews it as
 * `PrimitivesBoard`; `PrimitiveSheet` stills sample it for `docs/primitives/`.
 */
export const primitivesBoardSpec = parseRenderableSpec(primitivesBoardJson);

/** Example series data; real values come from the DB `series` row at render time. */
export const fixtureSeries: SeriesProps = { label: 'System Design', accentColour: '#4F8CFF' };

/** Example channel handle; real values come from the DB `channels.handle` at render time. */
export const fixtureChannelHandle = '@explainer.studio';
