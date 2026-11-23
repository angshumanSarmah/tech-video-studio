import { parseSourceChunkId } from '../domain/sources.ts';
import { incidentSourceIds } from '../director/systems.ts';
import type { DirectorPlan } from '../director/plan.ts';
import type { ResearchNotes } from '../research/notes.ts';
import type { BeatScript } from '../spec/script.ts';

/**
 * The names an incident story uses for the incident's organisation ("Larkspur Pay"), so example
 * numbers from another source are never credited to it. Read from the plan's `real_incident`
 * beats: their source lines, the titles of the sources they cite, the incident publishers the
 * notes give for those sources, and the names their narration uses. Pure.
 */

/** A source as the checks know it. */
export interface IncidentSource {
  readonly sourceId: number;
  readonly title: string | null;
  readonly origin: string;
}

const INCIDENT_DEVICE = 'real_incident';

/** Capitalised words that are not names: months, days, document and team words, articles. */
const NOT_NAMES = new Set(
  (
    'january february march april may june july august september october november december ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday ' +
    'saturday sunday the a an our their this that these those in on at of for and or to from by ' +
    'with after before then so but here when why how what source sources report reports ' +
    'post-incident incident incidents outage postmortem post-mortem platform team teams ' +
    'engineering blog readme guide field notes docs documentation paper status page update'
  ).split(' '),
);

const CAPITALISED = /^\p{Lu}[\p{L}\d'’-]*$/u;

/** A word as a name part: possessive "'s" and edge punctuation dropped. */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '').replace(/['’]s$/u, '');
}

const isNamePart = (word: string) => CAPITALISED.test(word) && !NOT_NAMES.has(word.toLowerCase());

/**
 * Runs of capitalised name words in a text ("Larkspur Pay"), each run's first word too when it
 * stands alone in speech ("Larkspur's"). In `narration` a sentence's first word starts a run
 * only when the next word is a name word too, since any word is capitalised there.
 */
function namesIn(text: string, narration = false): string[] {
  const names: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|[,;:()|]/u)) {
    let run: string[] = [];
    const flush = () => {
      if (run.length > 0) names.push(run.join(' '), ...(run.length > 1 ? [run[0]!] : []));
      run = [];
    };
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, i) => {
      const word = bare(raw);
      // Any word is capitalised at a sentence's start: there it needs a name word after it.
      const opener = narration && i === 0 && !isNamePart(bare(words[1] ?? ''));
      if (word && isNamePart(word) && !opener) {
        run.push(word);
        if (/[^\p{L}\d'’]$/u.test(raw)) flush();
      } else flush();
    });
    flush();
  }
  return names.filter((n) => n.length >= 3);
}

/** The incident's organisation names, longest first (so a message names "Larkspur Pay"). */
export function incidentNames(
  plan: DirectorPlan,
  notes: ResearchNotes,
  script: readonly BeatScript[],
  sources: readonly IncidentSource[] = [],
): string[] {
  const incidentBeats = plan.story.beats.filter((b) => b.device === INCIDENT_DEVICE);
  if (incidentBeats.length === 0) return [];
  const sourceIds = incidentSourceIds(plan, notes) ?? new Set<number>();
  const ids = new Set(incidentBeats.map((b) => b.id));
  const publishers = notes.failureModes
    .filter((f) =>
      f.sourceChunkIds.some((c) => sourceIds.has(parseSourceChunkId(c)?.sourceId ?? -1)),
    )
    .map((f) => f.incident?.publisher ?? '');
  const texts = [
    ...incidentBeats.map((b) => b.source ?? ''),
    ...sources.filter((s) => sourceIds.has(s.sourceId)).map((s) => s.title ?? ''),
    ...publishers,
  ];
  const narration = script.filter((s) => ids.has(s.beatId)).map((s) => s.narration);
  const names = [
    ...new Set([
      ...texts.flatMap((t) => namesIn(t)),
      ...narration.flatMap((t) => namesIn(t, true)),
    ]),
  ];
  return names.sort((a, b) => b.length - a.length);
}
