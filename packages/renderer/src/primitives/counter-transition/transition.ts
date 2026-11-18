/** What a counter transition shows at a frame; each part is an opacity or offset (0..1). */
export type TransitionView = {
  /** 1 = `from` in its own colour; falls toward muted as the transition plays. */
  fromStrength: number;
  arrow: number;
  to: number;
  /** Slide-in of `to`: 1 = fully offset to the left, 0 = in place. */
  toShift: number;
};

/**
 * Without a `count` event (`countProgress` undefined) the transition is shown as done: "10 → 9".
 * With one, `from` stands alone until the count begins, then the arrow and `to` come in while
 * `from` fades back.
 */
export function transitionView(countProgress: number | undefined): TransitionView {
  const p = countProgress ?? 1;
  return { fromStrength: 1 - 0.6 * p, arrow: p, to: p, toShift: 1 - p };
}
