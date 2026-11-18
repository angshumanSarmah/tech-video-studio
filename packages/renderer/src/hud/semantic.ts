import type { HeadlineSemantic } from '@explainer-studio/shared';
import type { SemanticColour } from '../theme/index.ts';

/** Headline semantics (script layer) to theme colours. */
export const HEADLINE_COLOURS: Record<HeadlineSemantic, SemanticColour> = {
  concept: 'concept',
  decision: 'focus',
  problem: 'problem',
  resolution: 'ok',
};
