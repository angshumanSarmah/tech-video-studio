import { parseSourceChunkId } from '../domain/sources.ts';
import type { ResearchNotes } from '../research/notes.ts';
import type { StoryBeat } from '../spec/story.ts';
import type { DirectorPlan } from './plan.ts';

/**
 * One system per story: in a video with a real incident, the incident's sources are the ones its
 * `real_incident` beats cite, and a number from any other source is an example (a guide's, a
 * library's) that the story must label as one. Shared by the Director's `mixed_system_numbers`
 * and the Scriptwriter's `example_not_labelled`. Pure.
 */

const INCIDENT_DEVICE = 'real_incident';

/** The research ids (facts, numbers, hook numbers) a beat cites. */
function citedIds(beat: StoryBeat): string[] {
  return [...(beat.hookNumberIds ?? []), ...beat.factIds];
}

function sourceOf(chunkId: string): number | undefined {
  return parseSourceChunkId(chunkId)?.sourceId;
}

/** The source ids a research fact or number cites. */
function sourcesOfId(notes: ResearchNotes, id: string): number[] {
  const number = notes.numbers.find((n) => n.id === id);
  if (number) return [sourceOf(number.sourceChunkId)].filter((s) => s !== undefined);
  const fact = notes.facts.find((f) => f.id === id);
  return (fact?.sourceChunkIds ?? []).map(sourceOf).filter((s) => s !== undefined);
}

/**
 * The incident's sources: those cited by the plan's `real_incident` beats. Undefined when the
 * plan has no such beat (not an incident story, so nothing is an example) or they cite nothing.
 */
export function incidentSourceIds(
  plan: DirectorPlan,
  notes: ResearchNotes,
): ReadonlySet<number> | undefined {
  const beats = plan.story.beats.filter((b) => b.device === INCIDENT_DEVICE);
  const sources = new Set(
    beats.flatMap((b) => citedIds(b).flatMap((id) => sourcesOfId(notes, id))),
  );
  // An incident that cites nothing has no sources to compare with (`incident_without_facts`).
  return sources.size > 0 ? sources : undefined;
}

/**
 * The research numbers a beat cites from sources other than the incident's, by source id. Empty
 * for an incident beat itself, and when there is no incident.
 */
export function exampleNumberIds(
  beat: StoryBeat,
  notes: ResearchNotes,
  incident: ReadonlySet<number> | undefined,
): Map<number, string[]> {
  const bySource = new Map<number, string[]>();
  if (!incident || beat.device === INCIDENT_DEVICE) return bySource;
  for (const id of citedIds(beat).filter((i) => i.startsWith('num-'))) {
    for (const source of sourcesOfId(notes, id)) {
      if (incident.has(source)) continue;
      bySource.set(source, [...(bySource.get(source) ?? []), id]);
    }
  }
  return bySource;
}
