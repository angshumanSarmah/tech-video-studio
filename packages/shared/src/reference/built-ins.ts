/**
 * What the renderer draws by itself (P1C.11), so a reference never lists it as missing: the
 * HUD, captions, footnotes, the camera, transitions and the rest. The Reference analyst reads
 * the list as a closed section after the catalogue (`builtInsSection`), and
 * `unmapped_is_built_in` flags an unmapped item whose name uses one of these phrases. Pure.
 */

export interface RendererBuiltIn {
  readonly id: string;
  readonly text: string;
  /** Name phrases (snake_case, whole words) that mean this built-in. */
  readonly phrases: readonly string[];
}

export const RENDERER_BUILT_INS: readonly RendererBuiltIn[] = [
  {
    id: 'card_format',
    text: 'The card format: a title header for the whole video over a 16:9 diagram window, with the headline and captions below.',
    phrases: ['card_format', 'card_layout', 'title_header', 'diagram_window', 'caption_band'],
  },
  {
    id: 'hud',
    text: 'HUD parts: a pinned hero metric, a running story clock, a step tracker with step names, a chapter header.',
    phrases: ['hud', 'hero_metric', 'story_clock', 'step_tracker', 'chapter_header', 'roadmap_bar'],
  },
  {
    id: 'headline',
    text: 'One headline per beat over the board.',
    phrases: ['headline'],
  },
  {
    id: 'captions',
    text: 'Word-by-word captions of the narration.',
    phrases: ['caption', 'captions', 'subtitle', 'subtitles', 'karaoke'],
  },
  {
    id: 'source_footnote',
    text: 'A "Source: …" line at the board’s foot on any beat that cites a source.',
    phrases: ['footnote', 'source_footnote', 'source_line', 'citation'],
  },
  {
    id: 'example_stamp',
    text: 'An EXAMPLE stamp on a beat whose numbers are an example.',
    phrases: ['example_stamp'],
  },
  {
    id: 'ending_card',
    text: 'The ending card: a spec card of up to three lines, the series number and a follow or share line.',
    phrases: ['ending_card', 'end_card', 'spec_card', 'share_prompt', 'follow_prompt'],
  },
  {
    id: 'focus_dimming',
    text: 'Everything outside the beat’s focus dims while the focus stays bright; an overlay card dims the board behind it.',
    phrases: ['dim', 'dims', 'dimming', 'dimmed', 'dimmed_scene', 'non_focus'],
  },
  {
    id: 'camera',
    text: 'A camera that frames, zooms and pans over the board, including pulling back over everything built so far.',
    phrases: ['camera', 'zoom', 'zoom_out', 'pan', 'pull_back'],
  },
  {
    id: 'persistent_board',
    text: 'A board that persists and grows across beats (a beat continues the previous one).',
    phrases: [
      'persistent_board',
      'persistent_scene',
      'persistent_world',
      'persistent_architecture',
    ],
  },
  {
    id: 'transitions',
    text: 'Cuts, fades, slides and zooms between boards, and a semantic zoom from one element into its own board.',
    phrases: ['transition', 'fade', 'slide_transition', 'semantic_zoom'],
  },
  {
    id: 'draw_on',
    text: 'Line work drawn on with a pen as each element enters.',
    phrases: ['draw_on', 'pen_draw'],
  },
];

/** The built-in a snake_case name means, if any (a phrase as whole words of the name). */
export function builtInNamed(name: string): RendererBuiltIn | undefined {
  const words = `_${name.toLowerCase().replaceAll('-', '_')}_`;
  return RENDERER_BUILT_INS.find((b) => b.phrases.some((p) => words.includes(`_${p}_`)));
}

/** The closed section after the catalogue in the Reference analyst's system message. */
export function builtInsSection(): string {
  const lines = RENDERER_BUILT_INS.map((b) => `- ${b.id}: ${b.text}`);
  return [
    '## BUILT INTO THE RENDERER (code draws these for every video: never list them in unmapped)',
    ...lines,
  ].join('\n');
}
