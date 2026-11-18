import { parseRenderableSpec } from '../src/compositions/metadata.ts';
import type { SeriesProps } from '../src/compositions/props.ts';
import rateLimiterJson from './rate-limiter.json';

/**
 * Renderable fixture without a timing layer, so Studio previews it with estimated timing (as a
 * spec looks before TTS). Validated at load: an invalid fixture fails loudly.
 */
export const rateLimiterSpec = parseRenderableSpec(rateLimiterJson);

/** Example series data; real values come from the DB `series` row at render time. */
export const fixtureSeries: SeriesProps = { label: 'System Design', accentColour: '#4F8CFF' };
