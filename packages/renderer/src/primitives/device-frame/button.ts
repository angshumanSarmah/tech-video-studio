import type { SemanticColour } from '../../theme/index.ts';
import type { DeviceButton } from './definition.ts';

/** One face of the button and how visible it is. */
export type ButtonFace = { label: string; semantic: SemanticColour; opacity: number };

/**
 * The faces to draw: the button as authored, cross-fading into `then` as `morph` plays
 * (`morphProgress` 0 until it starts; undefined without a `morph` event).
 */
export function buttonFaces(button: DeviceButton, morphProgress: number | undefined): ButtonFace[] {
  const p = button.then ? (morphProgress ?? 0) : 0;
  const first = { label: button.label, semantic: button.semantic, opacity: 1 - p };
  if (!button.then || p <= 0) return [{ ...first, opacity: 1 }];
  const second = { label: button.then.label, semantic: button.then.semantic, opacity: p };
  return p >= 1 ? [second] : [first, second];
}
