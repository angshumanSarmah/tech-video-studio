import {
  beatAssetLines,
  beatAssets,
  beatLayoutMode,
  boardNumberIds,
  boardState,
  DEFAULT_REGISTRIES,
  LAYOUT_MODES,
  pinHostText,
  type BoardEntry,
  type Registries,
} from '@explainer-studio/renderer/catalog';
import { getTheme, type Theme } from '@explainer-studio/renderer/theme';
import {
  effectiveTiming,
  foldTerm,
  normalizeWord,
  sentenceStartIndexes,
  type BeatTiming,
  type RenderableVideoSpec,
  type ResearchNotes,
  type StoryBeat,
} from '@explainer-studio/shared';
import { boardStart, spliceBoards, type GeneratorBoards } from './board.ts';

/**
 * The Generator's run input for one beat (the user message, P1C.7). The static parts (role
 * prompt, output schema, catalogue, assets) live in the system message; everything here is this
 * beat's: its story and script, its narration words numbered with their times, the research it
 * may show (its own and the earlier beats' on the same board), the terms introduced so far, the
 * board it fills (format, fixed layout mode, logo slots), the assets that fit this beat (P1C.12,
 * `beatAssets`) and, on a continuing beat, what is already ON SCREEN; on a semantic-zoom beat,
 * the previous board's elements to zoom from.
 */

export interface GeneratorMessageInput extends GeneratorBoards {
  readonly beatIndex: number;
  readonly notes: ResearchNotes;
  readonly registries?: Registries;
  readonly theme?: Theme;
  /** Why this board is drawn again (a gate's note, or the post-pass issues); last section. */
  readonly feedback?: string;
}

export function generatorUserMessage(input: GeneratorMessageInput): string {
  const spec = spliceBoards(input);
  const beat = spec.story.beats[input.beatIndex];
  if (!beat) throw new Error(`No story beat at index ${input.beatIndex}.`);
  const options = {
    registries: input.registries ?? DEFAULT_REGISTRIES,
    theme: input.theme ?? getTheme(),
  };
  const previous = spec.story.beats[input.beatIndex - 1];
  const sections = [
    intro(spec, beat, input.beatIndex),
    section('VIDEO', json(videoInput(spec))),
    section('BEAT', json(beatInput(spec, beat))),
    section('SCRIPT', json(scriptInput(spec, beat.id))),
    wordsSection(spec, beat, input.beatIndex),
    section(
      'RESEARCH (the only facts; numbers: the only ones a label may show)',
      json(researchInput(spec, input)),
    ),
    section('TERMS', json(termsInput(spec, input))),
    section('BOARD', json(boardInput(spec, input, options.registries))),
    assetsSection(spec, input, options.registries),
    ...(beat.continuesPrevious && previous ? continuing(spec, previous, options) : []),
    ...(beat.device === 'semantic_zoom' && previous ? [zoomSection(spec, previous, options)] : []),
    ...(input.feedback?.trim()
      ? [section('FEEDBACK (draw this board again and fix this)', input.feedback.trim())]
      : []),
  ];
  return sections.join('\n\n');
}

function intro(spec: RenderableVideoSpec, beat: StoryBeat, index: number): string {
  const total = spec.story.beats.length;
  const board = beat.continuesPrevious
    ? "It continues the previous beat's board: everything ON SCREEN is still there."
    : 'It starts a new board.';
  return (
    `Draw the board for beat "${beat.id}" (${index + 1} of ${total}). ${board} ` +
    "Return only this beat's board as one JSON object."
  );
}

const section = (title: string, body: string) => `## ${title}\n${body}`;
const json = (value: unknown) => JSON.stringify(value, null, 2);

function videoInput(spec: RenderableVideoSpec) {
  const { story, meta } = spec;
  return {
    title: meta.title,
    runningExample: story.runningExample ?? null,
    plantedQuestion: story.plantedQuestion ?? null,
  };
}

function beatInput(spec: RenderableVideoSpec, beat: StoryBeat) {
  const chapter = spec.story.chapters.find((c) => c.id === beat.chapterId);
  return {
    id: beat.id,
    chapter: chapter?.question ?? chapter?.title ?? null,
    intent: beat.intent,
    device: beat.device ?? null,
    continuesPrevious: beat.continuesPrevious,
    suggestedPatterns: beat.suggestedPatternIds,
    newTerms: beat.newTerms,
    exampleNumbers: beat.exampleNumbers,
  };
}

function scriptInput(spec: RenderableVideoSpec, beatId: string) {
  const script = spec.script.find((s) => s.beatId === beatId);
  if (!script) return null;
  const { narration, headline, tags, statCards, formulaCard, commandBubble, source } = script;
  return {
    narration,
    headline: headline ? { text: headline.text, semantic: headline.semantic } : null,
    tags,
    statCards: statCards.map(({ value, label }) => ({ value, label })),
    formulaCard: formulaCard ?? null,
    commandBubble: commandBubble ?? null,
    source: source ?? null,
  };
}

/**
 * One line per narration word, as `narrationWords` counts them (the index an anchor uses), with
 * the word as written and its start in seconds from the beat's start; the beat's length; and on
 * the final beat, the words the ending card covers.
 */
function wordsSection(spec: RenderableVideoSpec, beat: StoryBeat, index: number): string {
  const narration = spec.script.find((s) => s.beatId === beat.id)?.narration ?? '';
  const timing = effectiveTiming(spec).beats.find((b) => b.beatId === beat.id);
  const tokens = narration.split(/\s+/).filter((t) => normalizeWord(t).length > 0);
  const lines = tokens.map((token, i) => `${i} ${token} ${wordStart(timing, i)}`);
  const length = timing ? (timing.endSec - timing.startSec).toFixed(2) : '?';
  const notes = [`The narration lasts ${length} s.`, ...endingNote(spec, index, narration, timing)];
  return section(
    'NARRATION WORDS (anchor each event with {"type":"word","index":<index>}: index, word, seconds from the beat\'s start)',
    [...lines, ...notes].join('\n'),
  );
}

function wordStart(timing: BeatTiming | undefined, i: number): string {
  const word = timing?.words[i];
  return word && timing ? (word.startSec - timing.startSec).toFixed(2) : '?';
}

function endingNote(
  spec: RenderableVideoSpec,
  index: number,
  narration: string,
  timing: BeatTiming | undefined,
): string[] {
  const { ending } = spec.story;
  const card = (ending.specCard?.lines.length ?? 0) > 0 || Boolean(ending.cta);
  if (index !== spec.story.beats.length - 1 || !card) return [];
  const from = sentenceStartIndexes(narration).at(-1);
  if (from === undefined) return [];
  return [
    `The ending card covers the last sentence (words ${from} on, from ${wordStart(timing, from)} s): ` +
      'anchor nothing there.',
  ];
}

/** This beat's facts, and the numbers its board may show (its own and earlier beats'). */
function researchInput(spec: RenderableVideoSpec, input: GeneratorMessageInput) {
  const { notes, beatIndex } = input;
  const beat = spec.story.beats[beatIndex];
  const facts = new Map(notes.facts.map((f) => [f.id, f]));
  const numbers = new Map(notes.numbers.map((n) => [n.id, n]));
  return {
    facts: (beat?.factIds ?? []).flatMap((id) => {
      const fact = facts.get(id);
      return fact ? [{ id, statement: fact.statement }] : [];
    }),
    numbers: boardNumberIds(spec, notes, beatIndex).flatMap((id) => {
      const n = numbers.get(id);
      return n ? [{ id, value: n.value, unit: n.unit, context: n.context }] : [];
    }),
  };
}

/** Terms introduced so far (with their plain meaning), and the later ones a label must not name. */
function termsInput(spec: RenderableVideoSpec, input: GeneratorMessageInput) {
  const glossary = new Map(input.notes.glossary.map((g) => [foldTerm(g.term), g.plainMeaning]));
  const beats = spec.story.beats;
  const introduced = beats.slice(0, input.beatIndex + 1).flatMap((b) =>
    b.newTerms.map((term) => ({
      term,
      plainMeaning: glossary.get(foldTerm(term)) ?? null,
      beat: b.id,
    })),
  );
  const known = new Set(introduced.map((t) => foldTerm(t.term)));
  const later = beats
    .slice(input.beatIndex + 1)
    .flatMap((b) => b.newTerms)
    .filter((term) => !known.has(foldTerm(term)));
  return { introduced, notYet: [...new Set(later)] };
}

/**
 * The board this beat fills: format, the layout mode (the plan's on a board's first beat; on a
 * continuing beat, the mode its first beat's board took) with its zones and capacity, logos.
 */
function boardInput(
  spec: RenderableVideoSpec,
  input: GeneratorMessageInput,
  registries: Registries,
) {
  const start = boardStart(spec, input.beatIndex);
  const generated = start < input.beatIndex ? input.scenes[start] : undefined;
  const id = generated
    ? beatLayoutMode(generated, registries.patterns)
    : spec.story.beats[start]?.layoutMode;
  const mode = id === undefined ? undefined : LAYOUT_MODES.get(id);
  return {
    format: spec.meta.format,
    layoutMode: mode
      ? { id: mode.id, zones: mode.zones, maxUnits: mode.maxUnits }
      : 'from your first pattern (the plan fixes none)',
    logoSlots: (spec.logos ?? []).map(({ id: slot, label }) => ({ id: slot, label })),
  };
}

/**
 * The approved assets for this beat (`beatAssets`: this video's ids first, then matches for the
 * beat's words, then the topic class's families). Exhaustive except for a requested new id.
 */
function assetsSection(
  spec: RenderableVideoSpec,
  input: GeneratorMessageInput,
  registries: Registries,
): string {
  const beat = spec.story.beats[input.beatIndex];
  const glossary = new Map(input.notes.glossary.map((g) => [foldTerm(g.term), g.plainMeaning]));
  const meanings = (beat?.newTerms ?? []).flatMap((t) => glossary.get(foldTerm(t)) ?? []);
  const assets = beatAssets(spec, input.beatIndex, registries, { extraText: meanings });
  return section(
    'ASSETS (exhaustive for this beat: use only these ids, or request a new one)',
    beatAssetLines(assets).join('\n'),
  );
}

/** ON SCREEN and the previous beat's narration, for a beat that continues the board. */
function continuing(
  spec: RenderableVideoSpec,
  previous: StoryBeat,
  options: { registries: Registries; theme: Theme },
): string[] {
  const state = boardState(spec, previous.id, options);
  const narration = spec.script.find((s) => s.beatId === previous.id)?.narration ?? '';
  const capacity = state.maxUnits === undefined ? '' : ` of at most ${state.maxUnits}`;
  const lines = [
    ...state.entries.map(entryLine),
    `focus: ${state.focus.length > 0 ? state.focus.join(', ') : 'none'}`,
    `units on screen: ${state.units}${capacity}`,
    scaleLine(state.scale, state.readableScale),
  ];
  return [
    section(
      'ON SCREEN (exhaustive: the ids already on this board; act on them with events, never declare them again)',
      lines.join('\n'),
    ),
    section('PREVIOUS BEAT', json({ id: previous.id, narration })),
  ];
}

/**
 * The board's scale headroom: every element of a board keeps its place, so each one this beat
 * adds shrinks the whole board, and exiting one frees no room.
 */
export function scaleLine(scale: number, readable: number): string {
  const pct = (v: number) => Math.round(v * 100);
  const room = pct(scale) - pct(readable);
  const verdict =
    room <= 0
      ? 'none: add nothing beyond the script items'
      : room < 5
        ? 'almost none: add only the script items, each pinned to an element already here'
        : room < 15
          ? 'little: add few, small elements'
          : 'some';
  return (
    `space left: the board is drawn at ${pct(scale)}% of full size and text stays readable down to ` +
    `${pct(readable)}%, so room is ${verdict}. Everything here keeps its place and size; each ` +
    'element you add shrinks the whole board, and exiting one frees no room.'
  );
}

function entryLine(entry: BoardEntry): string {
  const what = entry.kind === 'pattern' ? `pattern ${entry.type}` : entry.type;
  const text = entry.text === undefined ? '' : ` "${entry.text}"`;
  const facts = [
    entry.present ? 'present' : 'exited',
    ...entry.held,
    ...(entry.highlighted ? ['highlighted'] : []),
    ...entry.heldParts.map((p) => `part ${p.part} ${p.held.join(', ')}`),
    `actions: ${entry.actions.join(', ')}`,
    pinHostText(entry.pinHost),
    ...(entry.parts
      ? [`parts: ${entry.parts.ids.join(', ')} (${entry.parts.actions.join(', ')})`]
      : []),
  ];
  const head = `- ${entry.id} (${what})${text}: ${facts.join('; ')}`;
  if (!entry.inner) return head;
  const inner = entry.inner.map((i) => {
    const state = [
      i.present ? 'present' : 'exited',
      ...i.held,
      ...(i.highlighted ? ['highlighted'] : []),
    ];
    return `  - ${i.id} (${i.primitive}): ${state.join('; ')}`;
  });
  return [
    `${head}; inner elements take only ${entry.innerActions?.join(', ') ?? ''} and host no pins:`,
    ...inner,
  ].join('\n');
}

/**
 * The previous board's components a semantic zoom may push into (`zoomFrom`): cards, icons and
 * pattern instances (`zoomable`), never tags or other pinned annotations.
 */
function zoomSection(
  spec: RenderableVideoSpec,
  previous: StoryBeat,
  options: { registries: Registries; theme: Theme },
): string {
  const state = boardState(spec, previous.id, options);
  const choices = state.entries
    .filter((e) => e.present && e.zoomable)
    .flatMap((e) => [
      `- ${e.id} (${e.kind === 'pattern' ? `pattern ${e.type}` : e.type})${e.text === undefined ? '' : ` "${e.text}"`}`,
      ...(e.inner ?? [])
        .filter((i) => i.present && i.zoomable)
        .map((i) => `- ${i.id} (${i.primitive})`),
    ]);
  return section(
    'ZOOM FROM (exhaustive: with transitionIn "zoom-in", set zoomFrom to one of these components of the previous board)',
    choices.length > 0 ? choices.join('\n') : '(the previous board is not generated yet)',
  );
}
