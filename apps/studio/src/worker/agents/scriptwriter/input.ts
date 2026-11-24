import {
  foldTerm,
  parseSourceChunkId,
  type DirectorPlan,
  type ExplanationLevel,
  type ResearchInput,
  type ResearchNotes,
  type StoryBeat,
  type VideoFormat,
  type WordBudget,
} from '@explainer-studio/shared';
import { notesWithoutChunks } from '../sections.ts';

/**
 * The Scriptwriter's run input (the user message). Static parts (role prompt, output schema)
 * live in the system message; everything here varies by run. Each beat carries what writing it
 * needs: its word budget, the new terms it introduces with their plain meaning, the hook's
 * numbers and the research it uses, resolved, so the model never has to look ids up.
 */

const INTRO =
  'Write the script for this plan: one entry per beat, in the same order. The research notes ' +
  'below are the only facts; every number you write or say is one of their number values. ' +
  'Keep each narration within its word budget.';

export interface ScriptwriterMessage {
  readonly topic: { readonly title: string; readonly notes: string | null };
  readonly series: { readonly name: string };
  readonly level: ExplanationLevel;
  readonly format: VideoFormat;
  readonly plan: DirectorPlan;
  readonly notes: ResearchNotes;
  /** The research step's input: where each number's source title comes from. */
  readonly research: ResearchInput;
  readonly budgets: readonly WordBudget[];
}

/** `intro` replaces the opening instruction (the Curator's repairs revise one beat). */
export function scriptwriterUserMessage(
  input: ScriptwriterMessage,
  options: { readonly intro?: string } = {},
): string {
  const { plan } = input;
  const { story } = plan;
  const sources = numberSources(input.notes, input.research);
  const payload = {
    topic: input.topic.title,
    angle: input.topic.notes,
    series: input.series.name,
    explanationLevel: input.level,
    format: input.format,
    title: plan.meta.title,
    hook: story.hook,
    runningExample: story.runningExample ?? null,
    heroMetric: story.heroMetric ?? null,
    plantedQuestion: story.plantedQuestion ?? null,
    rejectedAlternative: story.rejectedAlternative ?? null,
    ...(plan.parts
      ? {
          parts: plan.parts.map(({ part, title, mainIdea, beatIds }) => ({
            part,
            title,
            mainIdea,
            beatIds,
          })),
        }
      : {}),
    beats: story.beats.map((beat) => beatInput(beat, input, sources)),
    ending: story.ending,
    researchNotes: notesWithSources(input.notes, sources),
  };
  return `${options.intro ?? INTRO}\n\n${JSON.stringify(payload, null, 2)}`;
}

function beatInput(beat: StoryBeat, input: ScriptwriterMessage, sources: Map<string, string>) {
  const { notes, plan } = input;
  const budget = input.budgets.find((b) => b.beatId === beat.id);
  const chapter = plan.story.chapters.find((c) => c.id === beat.chapterId);
  const glossary = new Map(notes.glossary.map((g) => [foldTerm(g.term), g]));
  const facts = new Map(notes.facts.map((f) => [f.id, f]));
  const numbers = new Map(notes.numbers.map((n) => [n.id, n]));
  const numberInput = (id: string) => {
    const n = numbers.get(id);
    return n
      ? [{ id, value: n.value, unit: n.unit, context: n.context, source: sources.get(id) }]
      : [];
  };
  return {
    id: beat.id,
    chapter: chapter?.question ?? chapter?.title,
    intent: beat.intent,
    device: beat.device ?? null,
    continuesPrevious: beat.continuesPrevious,
    exampleNumbers: beat.exampleNumbers,
    wordBudget: budget
      ? { words: budget.words, min: budget.min, max: budget.max, seconds: budget.narrationSec }
      : null,
    newTerms: beat.newTerms.map((term) => ({
      term,
      plainMeaning: glossary.get(foldTerm(term))?.plainMeaning ?? null,
    })),
    ...(beat.hookNumberIds ? { hookNumbers: beat.hookNumberIds.flatMap(numberInput) } : {}),
    facts: beat.factIds.flatMap((id) => {
      const f = facts.get(id);
      return f ? [{ id, statement: f.statement }] : [];
    }),
    numbers: beat.factIds.filter((id) => id.startsWith('num-')).flatMap(numberInput),
    source: beat.source ?? null,
  };
}

/** Each research number's source, by title (else its URL or file name), for source lines. */
function numberSources(notes: ResearchNotes, research: ResearchInput): Map<string, string> {
  const titles = new Map(research.sources.map((s) => [s.sourceId, s.title ?? s.origin]));
  return new Map(
    notes.numbers.flatMap((n) => {
      const title = titles.get(parseSourceChunkId(n.sourceChunkId)?.sourceId ?? -1);
      return title ? [[n.id, title] as const] : [];
    }),
  );
}

/** The notes without chunk ids, each number carrying its source title instead. */
function notesWithSources(notes: ResearchNotes, sources: Map<string, string>): unknown {
  const plain = notesWithoutChunks(notes) as { numbers: { id: string; source?: string }[] };
  for (const n of plain.numbers) {
    const source = sources.get(n.id);
    if (source) n.source = source;
  }
  return plain;
}
