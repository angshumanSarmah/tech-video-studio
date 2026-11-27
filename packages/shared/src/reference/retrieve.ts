import { z } from 'zod';
import { DeviceIdSchema, type DeviceId } from '../catalogues/devices.ts';
import { TOPIC_CLASS_CATALOGUE } from '../catalogues/topic-classes.ts';
import { mainPatternSequence, type RecentStructure } from '../memory/fingerprint.ts';
import { topicSimilarity } from '../memory/topic-similarity.ts';
import type { ResearchNotes } from '../research/notes.ts';
import { TopicClassSchema, type TopicClass } from '../spec/meta.ts';
import { referenceDevices, referencePatterns, type ReferenceRecord } from './record.ts';

/**
 * Picking reference videos for a Director call (P1C.11), in code: no embeddings, no model. The
 * run's topic class is not known before the Director answers, so it is expected: a previous
 * plan's class, else the class whose example topics the title is closest to, else the series'
 * (AI: ai-ml). Candidate devices are that class's preferred ones plus what the notes support
 * (an incident, failure modes, rejected alternatives, misconceptions, numbers). A reference
 * scores on class, shared devices and series, and loses for a hook or main pattern sequence a
 * recent video used and for each recent video that was shown it, so the Director is not pushed
 * back to a structure it just used. Up to `MAX_REFERENCES` above `MIN_REFERENCE_SCORE`, no two
 * with the same hook device. Pure and deterministic.
 */

export const MAX_REFERENCES = 3;
export const MIN_REFERENCE_SCORE = 2;

/** A title at least this close to one of a class's example topics expects that class. */
export const CLASS_GUESS_SIMILARITY = 0.5;

export const REFERENCE_SCORE = {
  classMatch: 3,
  secondaryClassMatch: 1.5,
  perSharedDevice: 1,
  maxSharedDevices: 5,
  seriesMatch: 1,
  recentHook: -2,
  recentSequence: -2,
  perRecentShowing: -1,
} as const;

/** Notes with this many numbers support a pinned hero metric. */
const HERO_METRIC_NUMBERS = 3;

/** Expected class by series when the title names no class's example: AI topics are ai-ml. */
const SERIES_CLASS: Readonly<Record<string, TopicClass>> = { ai: 'ai-ml' };

export interface RetrievalReference {
  readonly slug: string;
  readonly record: ReferenceRecord;
}

export interface RetrievalInput {
  readonly topicTitle: string;
  readonly seriesTag: string;
  readonly notes?: ResearchNotes;
  /** The class of a plan this run already has (a regenerate or rerun). */
  readonly previousTopicClass?: TopicClass;
  /** Recent videos' structures (`directorMemory`), and how many of them were shown each slug. */
  readonly recent: {
    readonly structures: readonly RecentStructure[];
    readonly referencesShown: Readonly<Record<string, number>>;
  };
  readonly references: readonly RetrievalReference[];
}

export const ReferencePickSchema = z.strictObject({
  slug: z.string(),
  score: z.number(),
  /** What the score is made of, in words ("class concept +3", "hook used recently −2"). */
  reasons: z.array(z.string()),
});
export type ReferencePick = z.infer<typeof ReferencePickSchema>;

export const ExpectedClassSchema = z.strictObject({
  topicClass: TopicClassSchema,
  from: z.enum(['previous_plan', 'title', 'series']),
});
export type ExpectedClass = z.infer<typeof ExpectedClassSchema>;

export interface Retrieval {
  readonly expected?: ExpectedClass;
  readonly candidateDevices: readonly DeviceId[];
  /** Every reference scored, best first (the picks among them). */
  readonly scored: readonly ReferencePick[];
  readonly picks: readonly ReferencePick[];
}

export function pickReferences(input: RetrievalInput): Retrieval {
  const expected = expectedClass(input);
  const candidates = candidateDevices(expected?.topicClass, input.notes);
  const preferred = new Set(
    expected ? classEntry(expected.topicClass).preferredDevices : ([] as DeviceId[]),
  );
  const recentHooks = new Set(input.recent.structures.flatMap((s) => s.hooks));
  const recentSequences = new Set(input.recent.structures.flatMap((s) => s.sequences));
  const scored = input.references
    .map((ref) => ({
      ref,
      pick: score(ref, { input, expected, candidates, recentHooks, recentSequences }),
      preferredOverlap: referenceDevices(ref.record).filter((d) => preferred.has(d)).length,
    }))
    .sort(
      (a, b) =>
        b.pick.score - a.pick.score ||
        b.preferredOverlap - a.preferredOverlap ||
        byCodeUnits(a.ref.slug, b.ref.slug),
    );
  const picks: ReferencePick[] = [];
  const hookDevices = new Set<string>();
  for (const { ref, pick } of scored) {
    if (picks.length >= MAX_REFERENCES || pick.score < MIN_REFERENCE_SCORE) break;
    if (hookDevices.has(ref.record.hook.device)) continue;
    hookDevices.add(ref.record.hook.device);
    picks.push(pick);
  }
  return {
    ...(expected ? { expected } : {}),
    candidateDevices: [...candidates],
    scored: scored.map((s) => s.pick),
    picks,
  };
}

/** The class the Director will most likely choose, and where the guess comes from. */
export function expectedClass(input: RetrievalInput): ExpectedClass | undefined {
  if (input.previousTopicClass) {
    return { topicClass: input.previousTopicClass, from: 'previous_plan' };
  }
  const prior = SERIES_CLASS[input.seriesTag];
  let best: { topicClass: TopicClass; similarity: number } | undefined;
  for (const entry of TOPIC_CLASS_CATALOGUE.entries) {
    const similarity = Math.max(
      ...entry.exampleTopics.map((example) => topicSimilarity(input.topicTitle, example)),
    );
    if (similarity < CLASS_GUESS_SIMILARITY) continue;
    const better =
      !best ||
      similarity > best.similarity ||
      (similarity === best.similarity && entry.id === prior);
    if (better) best = { topicClass: entry.id, similarity };
  }
  if (best) return { topicClass: best.topicClass, from: 'title' };
  return prior ? { topicClass: prior, from: 'series' } : undefined;
}

/** The expected class's preferred devices, then what the notes support, in that order. */
export function candidateDevices(
  topicClass: TopicClass | undefined,
  notes: ResearchNotes | undefined,
): DeviceId[] {
  const devices: DeviceId[] = topicClass ? [...classEntry(topicClass).preferredDevices] : [];
  if (notes) devices.push(...noteDevices(notes));
  return [...new Set(devices)];
}

/**
 * Devices the notes have the material for: only items not marked `off` the angle count
 * (researcher@v4), so a reference is not picked for a device only off-angle material supports.
 */
function noteDevices(notes: ResearchNotes): DeviceId[] {
  const onAngle = <T extends { angle?: string | undefined }>(items: readonly T[]) =>
    items.filter((i) => i.angle !== 'off');
  const failures = onAngle(notes.failureModes);
  const devices: DeviceId[] = [];
  if (failures.some((f) => f.kind === 'incident')) devices.push('real_incident');
  if (failures.length > 0) devices.push('what_breaks', 'failure_before_fix');
  if (onAngle(notes.rejectedAlternatives).length > 0) {
    devices.push('brute_force_first', 'versus_split', 'counterfactual');
  }
  if (onAngle(notes.misconceptions).length > 0) devices.push('seen_this_bug');
  if (onAngle(notes.numbers).length >= HERO_METRIC_NUMBERS) devices.push('hero_metric');
  return DeviceIdSchema.array().parse(devices);
}

interface ScoreContext {
  readonly input: RetrievalInput;
  readonly expected: ExpectedClass | undefined;
  readonly candidates: readonly DeviceId[];
  readonly recentHooks: ReadonlySet<string>;
  readonly recentSequences: ReadonlySet<string>;
}

function score(ref: RetrievalReference, ctx: ScoreContext): ReferencePick {
  const { record } = ref;
  const parts: [number, string][] = [];
  const cls = ctx.expected?.topicClass;
  if (cls && record.topicClass === cls) parts.push([REFERENCE_SCORE.classMatch, `class ${cls}`]);
  else if (cls && record.secondaryTopicClass === cls) {
    parts.push([REFERENCE_SCORE.secondaryClassMatch, `secondary class ${cls}`]);
  }
  const candidates = new Set(ctx.candidates);
  const shared = referenceDevices(record).filter((d) => candidates.has(d));
  const counted = shared.slice(0, REFERENCE_SCORE.maxSharedDevices);
  if (counted.length > 0) {
    parts.push([REFERENCE_SCORE.perSharedDevice * counted.length, `devices ${counted.join(', ')}`]);
  }
  if (record.series.includes(ctx.input.seriesTag)) {
    parts.push([REFERENCE_SCORE.seriesMatch, `series ${ctx.input.seriesTag}`]);
  }
  const { hook, sequence } = referenceFingerprint(record);
  if (ctx.recentHooks.has(hook)) {
    parts.push([REFERENCE_SCORE.recentHook, `hook ${hook} used by a recent video`]);
  }
  if (sequence && ctx.recentSequences.has(sequence)) {
    parts.push([REFERENCE_SCORE.recentSequence, `patterns ${sequence} used by a recent video`]);
  }
  const shown = ctx.input.recent.referencesShown[ref.slug] ?? 0;
  if (shown > 0) {
    parts.push([REFERENCE_SCORE.perRecentShowing * shown, `shown for ${shown} recent video(s)`]);
  }
  const total = parts.reduce((sum, [n]) => sum + n, 0);
  return {
    slug: ref.slug,
    score: total,
    reasons: parts.map(([n, why]) => `${why} ${n > 0 ? '+' : '−'}${Math.abs(n)}`),
  };
}

/** A reference's hook (`<kind>/<device>`) and main pattern sequence, as recent videos record theirs. */
export function referenceFingerprint(record: ReferenceRecord): { hook: string; sequence?: string } {
  const sequence = mainPatternSequence(referencePatterns(record));
  return { hook: `${record.hook.kind}/${record.hook.device}`, ...(sequence ? { sequence } : {}) };
}

function classEntry(id: TopicClass) {
  const entry = TOPIC_CLASS_CATALOGUE.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No topic class ${id}`);
  return entry;
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
