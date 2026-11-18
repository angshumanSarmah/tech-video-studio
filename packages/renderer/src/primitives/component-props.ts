import type { Theme } from '../theme/index.ts';
import type { ElementState } from './element-state.ts';
import type { Size } from './types.ts';

/**
 * What every primitive component receives: parsed props, the box the layout gave it, and its
 * state at the current frame. Never raw events or anchors (see `elementState`).
 */
export type PrimitiveComponentProps<P> = {
  theme: Theme;
  props: P;
  box: Size;
  state: ElementState;
};

/** Opacity and scale shared by all primitives: presence, dimming and emphasis. */
export function stateStyle(state: ElementState) {
  const opacity = state.presence * (1 - 0.7 * state.dimmed);
  const scale = (0.9 + 0.1 * state.presence) * (1 + 0.06 * state.emphasis);
  return { opacity, transform: `scale(${scale})` } as const;
}
