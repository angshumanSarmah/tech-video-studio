import type { ReactNode } from 'react';
import type { Theme } from '../theme/index.ts';
import type { ElementState, PartState } from './element-state.ts';
import type { Point } from './geometry.ts';
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
  /**
   * The path a relational primitive (`connector`, `packet_stream`) runs along, in its own box px.
   * Layout output, never authored; absent when it stands alone (sheets), where it draws across
   * its box.
   */
  path?: readonly Point[];
  /**
   * Contained elements, already drawn (an `inset_panel`'s children; see `ElementRef.contains`).
   * Only containers read it.
   */
  children?: ReactNode;
};

/** Opacity and scale shared by all primitives: presence, dimming and emphasis. */
export function stateStyle(state: Pick<PartState, 'presence' | 'dimmed' | 'emphasis'>) {
  const opacity = state.presence * (1 - 0.7 * state.dimmed);
  const scale = (0.9 + 0.1 * state.presence) * (1 + 0.06 * state.emphasis);
  return { opacity, transform: `scale(${scale})` } as const;
}
