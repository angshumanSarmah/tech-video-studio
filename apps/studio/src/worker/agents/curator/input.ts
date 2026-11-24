import {
  DEFAULT_REGISTRIES,
  describeBoard,
  type AnchorDescription,
  type BoardDescription,
  type BoardItemDescription,
  type EventDescription,
  type Registries,
} from '@explainer-studio/renderer/catalog';
import { getTheme, type Theme } from '@explainer-studio/renderer/theme';
import {
  dateOnlyKeys,
  foldTerm,
  measuredBeatLengths,
  numberIndex,
  numberKey,
  numberMentions,
  readability,
  type BeatScript,
  type CodeIssue,
  type Evidence,
  type ExplanationLevel,
  type PreviousIssue,
  type RenderableVideoSpec,
  type ResearchNotes,
  type ReviewBeatTexts,
  type StoryBeat,
} from '@explainer-studio/shared';
import { notesWithoutChunks } from '../sections.ts';

/**
 * The Curator's run input (the user message, P1C.8). The model reads text only, so each board
 * is described by code (`describeBoard`): every element with its texts, drawn numbers, colour
 * meanings, icons and refs, the narration word each change happens on, the focus, and what is
 * left on screen as the beat ends. NUMBERS lists each number a beat says or shows with the
 * research numbers that share its value (a shared value is not a shared meaning: that is what
 * the review checks). CODE FINDINGS are the code checks' results, so the review does not repeat
 * them. Order keeps the cacheable part first: the notes, then the video, then the beats; a second
 * round adds PREVIOUS ISSUES and CHANGED BEATS last. `reviewBeatTexts` gives the same texts to
 * the quote checks (`curatorIssueProblems`), so a quote of anything shown here verifies.
 */

export interface CuratorRound {
  /** The earlier round's issues, numbered `issue-<n>`. */
  readonly previous: readonly PreviousIssue[];
  /** Beats changed by the repairs since; new issues are reported only on these. */
  readonly changedBeatIds: readonly string[];
}

export interface CuratorMessageInput {
  readonly spec: RenderableVideoSpec;
  readonly notes: ResearchNotes;
  readonly level: ExplanationLevel;
  /** `curatorCodeChecks` on the same spec. */
  readonly codeIssues: readonly CodeIssue[];
  readonly round?: CuratorRound;
  readonly registries?: Registries;
  readonly theme?: Theme;
}

/** Research values a board may show without a research number (as the screen checks count). */
const EVERYDAY_KEYS: ReadonlySet<string> = new Set(['0', '1', '2', '3']);

export function curatorUserMessage(input: CuratorMessageInput): string {
  const { spec } = input;
  const boards = describeBoards(input);
  const findings = findingsByBeat(spec, input.codeIssues);
  const changed = new Set(input.round?.changedBeatIds ?? []);
  return [
    intro(spec, input.level),
    section('NOTES (the only facts; evidence cites their ids)', json(notesInput(input.notes))),
    section('VIDEO', videoLines(spec, input.notes, input.level).join('\n')),
    section('CODE FINDINGS (whole video; do not repeat them)', lines(findings.get('') ?? [])),
    ...spec.story.beats.map((beat, i) =>
      beatSection(input, beat, i, boards.get(beat.id), findings.get(beat.id) ?? [], changed),
    ),
    ...(input.round ? roundSections(input.round) : []),
  ].join('\n\n');
}

/** Each beat's texts as the message shows them: what an evidence quote must come from. */
export function reviewBeatTexts(
  spec: RenderableVideoSpec,
  options: { registries?: Registries; theme?: Theme } = {},
): ReviewBeatTexts[] {
  const boards = describeBoards({ spec, ...options });
  return spec.story.beats.map((beat) => {
    const script = scriptOf(spec, beat.id);
    const board = boards.get(beat.id);
    return {
      beatId: beat.id,
      narration: script?.narration ?? '',
      headline: script?.headline ? [script.headline.text] : [],
      tag: script?.tags ?? [],
      stat_card: (script?.statCards ?? []).flatMap((c) => [c.value, c.label]),
      source: script?.source ? [script.source] : [],
      labels: Object.fromEntries(board ? labelEntries(board) : []),
    };
  });
}

// --- Shared pieces -------------------------------------------------------------------------------

const section = (title: string, body: string) => `## ${title}\n${body}`;
const json = (value: unknown) => JSON.stringify(value, null, 2);
const lines = (items: readonly string[]) => (items.length > 0 ? items.join('\n') : 'none');
const quoted = (text: string) => `"${text}"`;

function describeBoards(input: {
  spec: RenderableVideoSpec;
  registries?: Registries;
  theme?: Theme;
}): Map<string, BoardDescription> {
  const options = {
    registries: input.registries ?? DEFAULT_REGISTRIES,
    theme: input.theme ?? getTheme(),
  };
  return new Map(
    input.spec.scenes.map((scene) => [
      scene.beatId,
      describeBoard(input.spec, scene.beatId, options),
    ]),
  );
}

function scriptOf(spec: RenderableVideoSpec, beatId: string): BeatScript | undefined {
  return spec.script.find((s) => s.beatId === beatId);
}

function labelEntries(board: BoardDescription): [string, string[]][] {
  return board.items.flatMap((item) => [
    [item.id, [...item.texts.map((t) => t.value), ...item.numbers.map((n) => String(n.value))]],
    ...item.inner.map((i): [string, string[]] => [i.id, i.texts]),
  ]);
}

function intro(spec: RenderableVideoSpec, level: ExplanationLevel): string {
  return (
    `Review this ${spec.story.beats.length}-beat video for ${level} viewers, beat by beat. ` +
    'Report each problem as one issue, quoting its evidence exactly as written below; report ' +
    'nothing for a beat that is fine. Return one JSON object.'
  );
}

/** The notes without chunk citations and without the Researcher's hook ideas (planning only). */
function notesInput(notes: ResearchNotes): unknown {
  const plain = notesWithoutChunks(notes) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(plain).filter(([key]) => key !== 'hooks'));
}

// --- VIDEO --------------------------------------------------------------------------------------

function videoLines(
  spec: RenderableVideoSpec,
  notes: ResearchNotes,
  level: ExplanationLevel,
): string[] {
  const { story, meta } = spec;
  const lengths = measuredBeatLengths(spec);
  const runs = lengths.reduce((sum, b) => sum + b.spanSec, 0);
  const hook = story.beats.find((b) => (b.hookNumberIds ?? []).length > 0) ?? story.beats[0];
  const hookIds = hook?.hookNumberIds ?? [];
  const question = story.plantedQuestion;
  const rejected = story.rejectedAlternative;
  return [
    `title: ${quoted(meta.title)}`,
    `level: ${level} · format: ${meta.format} · planned ${meta.targetLengthSec} s` +
      (lengths.length > 0 ? ` · the beats run ${runs.toFixed(1)} s` : ''),
    `hook (${story.hook?.kind ?? 'problem'}): ${hook?.id ?? 'none'}` +
      (hookIds.length > 0 ? ` · its numbers ${hookIds.join(', ')}` : ''),
    `running example: ${story.runningExample ?? 'none'}`,
    question
      ? `planted question: ${quoted(question.text)} (asked in ${question.beatId}, paid off in ${question.payoffBeatId})`
      : 'planted question: none',
    rejected
      ? `rejected alternative (${rejected.beatId}): ${rejected.summary}` +
        (rejected.chosenBeatId ? ` · chosen design in ${rejected.chosenBeatId}` : '')
      : 'rejected alternative: none',
    `devices: ${story.devices.join(', ')}`,
    'terms, each introduced in its beat:',
    ...termLines(story.beats, notes),
  ];
}

function termLines(beats: readonly StoryBeat[], notes: ResearchNotes): string[] {
  const glossary = new Map(notes.glossary.map((g) => [foldTerm(g.term), g.plainMeaning]));
  const terms = beats.flatMap((b) =>
    b.newTerms.map(
      (term) => `- ${term} (${b.id}): ${glossary.get(foldTerm(term)) ?? 'not in the glossary'}`,
    ),
  );
  return terms.length > 0 ? terms : ['- none'];
}

// --- CODE FINDINGS ----------------------------------------------------------------------------------

/** Code findings by the beat their path points into ('' for the whole video). */
function findingsByBeat(
  spec: RenderableVideoSpec,
  issues: readonly CodeIssue[],
): Map<string, string[]> {
  const byBeat = new Map<string, string[]>();
  for (const issue of issues) {
    const beatId = beatOfPath(spec, issue.path);
    const line = `- ${issue.code} (${issue.severity}, ${issue.owner}): ${issue.message}`;
    byBeat.set(beatId, [...(byBeat.get(beatId) ?? []), line]);
  }
  return byBeat;
}

function beatOfPath(spec: RenderableVideoSpec, path: string): string {
  const match = /^\$\.(scenes|script|story\.beats)\[(\d+)\]/.exec(path);
  if (!match) return '';
  const i = Number(match[2]);
  if (match[1] === 'scenes') return spec.scenes[i]?.beatId ?? '';
  if (match[1] === 'script') return spec.script[i]?.beatId ?? '';
  return spec.story.beats[i]?.id ?? '';
}

// --- One beat ----------------------------------------------------------------------------------------

function beatSection(
  input: CuratorMessageInput,
  beat: StoryBeat,
  i: number,
  board: BoardDescription | undefined,
  findings: readonly string[],
  changed: ReadonlySet<string>,
): string {
  const { spec, notes } = input;
  const script = scriptOf(spec, beat.id);
  const chapter = spec.story.chapters.find((c) => c.id === beat.chapterId);
  const head =
    `BEAT ${beat.id} (${i + 1} of ${spec.story.beats.length})` +
    (chapter ? ` · chapter ${quoted(chapter.question ?? chapter.title)}` : '') +
    (beat.device ? ` · device ${beat.device}` : '') +
    (changed.has(beat.id) ? ' · CHANGED since the last review' : '');
  const body = [
    `intent: ${beat.intent}`,
    planLine(beat),
    lengthLine(spec, beat, script),
    `narration: ${quoted(script?.narration ?? '')}`,
    `on screen: ${screenLine(script)}`,
    'research it cites:',
    ...researchLines(spec, beat, notes),
    'numbers said or shown (each with the research numbers that have its value; the same value can mean something else):',
    ...numberLines(script, board, notes),
    ...(board ? boardLines(board) : ['board: none']),
    'code findings:',
    lines(findings),
  ];
  return section(head, body.join('\n'));
}

function planLine(beat: StoryBeat): string {
  return [
    `new terms: ${beat.newTerms.length > 0 ? beat.newTerms.join(', ') : 'none'}`,
    `example numbers: ${beat.exampleNumbers ? 'yes (an EXAMPLE stamp is drawn)' : 'no'}`,
    ...(beat.continuesPrevious ? ['continues the previous board'] : []),
  ].join(' · ');
}

function lengthLine(
  spec: RenderableVideoSpec,
  beat: StoryBeat,
  script: BeatScript | undefined,
): string {
  const measured = measuredBeatLengths(spec).find((b) => b.beatId === beat.id);
  const runs = measured ? `runs ${measured.spanSec.toFixed(1)} s` : 'not timed yet';
  const ease = script ? readability(script.narration)?.score : undefined;
  return `length: planned ${beat.targetSec} s, ${runs} · reading ease ${ease ?? '?'}`;
}

function screenLine(script: BeatScript | undefined): string {
  if (!script) return 'nothing';
  const parts = [
    ...(script.headline
      ? [`headline ${quoted(script.headline.text)} (${script.headline.semantic})`]
      : []),
    ...(script.tags.length > 0 ? [`tags ${script.tags.map(quoted).join(', ')}`] : []),
    ...script.statCards.map(
      (c) => `stat card ${quoted(c.value)} ${quoted(c.label)} (cites ${c.sourceRef})`,
    ),
    ...(script.formulaCard ? [`formula ${quoted(script.formulaCard.latex)}`] : []),
    ...(script.commandBubble ? [`command ${quoted(script.commandBubble.text)}`] : []),
    ...(script.source ? [`source line ${quoted(script.source)}`] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : 'nothing but the board';
}

function researchLines(spec: RenderableVideoSpec, beat: StoryBeat, notes: ResearchNotes): string[] {
  const script = scriptOf(spec, beat.id);
  const ids = [
    ...new Set([
      ...beat.factIds,
      ...(beat.hookNumberIds ?? []),
      ...(script?.statCards ?? []).map((c) => c.sourceRef),
    ]),
  ];
  const found = ids.flatMap((id) => {
    const fact = notes.facts.find((f) => f.id === id);
    if (fact) return [`- ${id}: ${fact.statement}`];
    const number = notes.numbers.find((n) => n.id === id);
    return number ? [`- ${numberText(number)}`] : [];
  });
  return found.length > 0 ? found : ['- none'];
}

function numberText(n: ResearchNotes['numbers'][number]): string {
  return `${n.id}: ${`${n.value} ${n.unit}`.trim()} · ${n.context}`;
}

// --- NUMBERS ------------------------------------------------------------------------------------------

/**
 * A text that states numbers: narration mentions as spoken, screen texts whole ("one of 24
 * nodes"), drawn numbers as values; `keys` are the values it states.
 */
type Shown = { where: string; text: string; keys: string[] };

/** Every number the beat says or shows, with the research numbers that state its value. */
function numberLines(
  script: BeatScript | undefined,
  board: BoardDescription | undefined,
  notes: ResearchNotes,
): string[] {
  const index = numberIndex(notes);
  const dates = dateOnlyKeys(notes);
  const byId = new Map(notes.numbers.map((n) => [n.id, n]));
  const meaning = (key: string): string => {
    const ids = index.idsByKey.get(key) ?? [];
    const found = ids.flatMap((id) => {
      const n = byId.get(id);
      return n ? [`${id} (${`${n.value} ${n.unit}`.trim()})`] : [];
    });
    if (found.length > 0) return found.join(' or ');
    return dates.has(key) ? 'a date the notes give' : 'no research number';
  };
  const found = [...spokenNumbers(script), ...boardNumbers(board)].flatMap((s) => {
    const keys = [...new Set(s.keys)].filter((k) => !EVERYDAY_KEYS.has(k));
    if (keys.length === 0) return [];
    return [`- ${s.where} ${quoted(s.text)} → ${[...new Set(keys.map(meaning))].join('; ')}`];
  });
  return found.length > 0 ? [...new Set(found)] : ['- none'];
}

const keysOf = (text: string) =>
  numberMentions(text)
    .filter((m) => !m.everyday)
    .map((m) => numberKey(m.value));

/** The narration's numbers one mention at a time, as spoken. */
function spokenNumbers(script: BeatScript | undefined): Shown[] {
  if (!script) return [];
  const whole = (where: string, text: string): Shown => ({ where, text, keys: keysOf(text) });
  return [
    ...numberMentions(script.narration)
      .filter((m) => !m.everyday)
      .map((m) => ({ where: 'narration', text: m.text, keys: [numberKey(m.value)] })),
    ...(script.headline ? [whole('headline', script.headline.text)] : []),
    ...script.tags.map((t) => whole('tag', t)),
    ...script.statCards.map((c) => whole('stat card', c.value)),
  ];
}

/** Numbers on what this beat adds to the board (what earlier beats added is listed there). */
function boardNumbers(board: BoardDescription | undefined): Shown[] {
  return (board?.items ?? [])
    .filter((item) => item.added)
    .flatMap((item) => [
      ...item.numbers.map((n) => ({
        where: `board ${item.id} ${n.key}`,
        text: String(n.value),
        keys: [numberKey(n.value)],
      })),
      ...item.texts.map((t) => ({
        where: `board ${item.id} ${t.key}`,
        text: t.value,
        keys: keysOf(t.value),
      })),
    ]);
}

// --- BOARD --------------------------------------------------------------------------------------------

function boardLines(board: BoardDescription): string[] {
  const kind = board.continues
    ? `continues ${board.continues}'s board`
    : `new board${board.transitionIn ? ` (${board.transitionIn} in)` : ''}`;
  const zoom = board.zoomFrom ? ` · zooms in from ${board.zoomFrom}` : '';
  const kept = board.items.filter((i) => !i.added);
  const added = board.items.filter((i) => i.added);
  return [
    `board: ${kind} · layout ${board.layoutMode}${zoom}`,
    ...(kept.length > 0 ? ['on screen from earlier beats:', ...kept.map(itemLine)] : []),
    ...(added.length > 0 ? ['added in this beat:', ...added.map(itemLine)] : []),
    `focus: ${focusText(board)}`,
  ];
}

function itemLine(item: BoardItemDescription): string {
  const type = item.kind === 'pattern' ? `pattern ${item.type}` : item.type;
  const parts = [
    `- ${item.id} · ${type}`,
    ...item.texts.map((t) => `${t.key} ${quoted(t.value)}`),
    ...item.numbers.map((n) => `${n.key} ${n.value}`),
    ...item.colours.map((c) => `${c.key} ${c.value}`),
    ...item.icons.map((c) => `${c.key} ${c.value}`),
    ...item.refs.map((r) => `${r.key} ${r.id}${r.side ? ` (${r.side})` : ''}`),
    ...item.anchors.map((a) => `${a.name} on ${anchorText(a.at)}`),
    ...item.events.map(eventText),
    ...endText(item),
  ];
  const inner = item.inner.map(
    (i) =>
      `  - ${i.id} · ${i.type}${i.texts.length > 0 ? ` · ${i.texts.map(quoted).join(', ')}` : ''}`,
  );
  return [parts.join(' · '), ...inner].join('\n');
}

function anchorText(at: AnchorDescription): string {
  if (at.kind === 'word') return `${at.index} ${quoted(at.word)}`;
  if (at.kind === 'unresolved') return 'an unresolved anchor';
  if (at.offsetSec === 0) return `the beat's ${at.edge}`;
  return `the beat's ${at.edge} ${at.offsetSec > 0 ? '+' : '−'} ${Math.abs(at.offsetSec)} s`;
}

function eventText(event: EventDescription): string {
  const what = event.target ? `${event.action} ${event.target}` : event.action;
  const how = [
    ...(event.parts ? [`parts ${event.parts.join(', ')}`] : []),
    ...(event.hold ? ['held'] : []),
    ...(event.scan ? ['one by one'] : []),
  ];
  return `${what} on ${anchorText(event.at)}${how.length > 0 ? ` (${how.join(', ')})` : ''}`;
}

function endText(item: BoardItemDescription): string[] {
  const state = [
    ...(item.end.present ? [] : ['gone']),
    ...item.end.held,
    ...(item.end.highlighted ? ['highlighted'] : []),
  ];
  return state.length > 0 ? [`as the beat ends: ${state.join(', ')}`] : [];
}

function focusText(board: BoardDescription): string {
  if (board.focus.length === 0) return 'none set';
  return board.focus
    .map(
      (f) =>
        `${f.ids.join(', ') || 'everything'} ${f.at === 'start' ? 'from the start' : `on ${anchorText(f.at)}`}`,
    )
    .join(' → ');
}

// --- A second round ------------------------------------------------------------------------------------

function roundSections(round: CuratorRound): string[] {
  const previous = round.previous.map(
    ({ id, issue }) =>
      `- ${id} · ${issue.beatId} · ${issue.category} · ${issue.severity} · ${issue.owner}: ` +
      `${issue.problem} Evidence: ${issue.evidence.map(evidenceText).join('; ')}. Fix asked: ${issue.fix}`,
  );
  const changed = round.changedBeatIds.length > 0 ? round.changedBeatIds.join(', ') : 'none';
  return [
    section(
      'PREVIOUS ISSUES (give each exactly one status in "previous": fixed or not_fixed)',
      lines(previous),
    ),
    section(
      'CHANGED BEATS (report new issues only on these; the others were reviewed already)',
      changed,
    ),
  ];
}

function evidenceText(e: Evidence): string {
  switch (e.kind) {
    case 'label':
      return `label ${e.elementId} ${quoted(e.quote)}`;
    case 'fact':
      return e.quote ? `fact ${e.id} ${quoted(e.quote)}` : `fact ${e.id}`;
    case 'number':
      return `number ${e.id}`;
    default:
      return `${e.kind.replace('_', ' ')} ${quoted(e.quote)}`;
  }
}
