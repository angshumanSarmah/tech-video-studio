/**
 * Characters of the on-screen text the Scriptwriter writes and the primitives that show it hold:
 * `tag`, `stat_card`, `command_bubble` and `formula_card` take their props limits from here, so
 * the Scriptwriter's output schema and the renderer cannot drift apart.
 */
export const ON_SCREEN_TEXT_LIMITS = {
  /** `tag.text`. */
  tag: 32,
  /** `stat_card.value`: the figure as displayed, units included. */
  statValue: 12,
  /** `stat_card.label`. */
  statLabel: 32,
  /** `command_bubble.text`. */
  command: 48,
  /** `formula_card.latex`. */
  latex: 80,
  /** `formula_card.caption`. */
  formulaCaption: 48,
} as const;

/** Tags one beat's script may ask for. */
export const MAX_TAGS_PER_BEAT = 3;

/** Stat cards one beat's script may ask for: the one number the beat is about. */
export const MAX_STAT_CARDS_PER_BEAT = 1;

/** Stat cards one video may show, so the ones that matter stand out. */
export const MAX_STAT_CARDS_PER_VIDEO = 4;
