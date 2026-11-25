import { z } from 'zod';
import { DeviceIdSchema } from '../catalogues/devices.ts';
import { TopicClassSchema, VideoFormatSchema } from '../spec/meta.ts';
import type { ReferenceRecord } from './record.ts';
import { ExpectedClassSchema, ReferencePickSchema, type ReferencePick } from './retrieve.ts';

/**
 * A reference as the Director reads it (P1C.11): structure only. No title or topic words, no
 * names to avoid, no unmapped items and no primitives; a label instead of its slug, so nothing
 * of the original's domain is offered as a name to reuse. Beat lines keep the structural
 * summary with its devices, patterns and layout mode. Pure.
 */
export const ReferenceBriefSchema = z.strictObject({
  label: z.string(),
  topicClass: TopicClassSchema,
  secondaryTopicClass: TopicClassSchema.optional(),
  format: VideoFormatSchema,
  lengthSec: z.number().int().optional(),
  /** Why it was picked for this run, in words. */
  whyPicked: z.string(),
  hook: z.string(),
  arc: z.string(),
  videoDevices: z.array(DeviceIdSchema),
  beats: z.array(z.string()),
  pacing: z.array(z.string()),
});
export type ReferenceBrief = z.infer<typeof ReferenceBriefSchema>;

/** What a Director step was shown (`DirectorInput.references`): the picks and the briefs as sent. */
export const DirectorReferencesSchema = z.strictObject({
  expected: ExpectedClassSchema.optional(),
  candidateDevices: z.array(DeviceIdSchema),
  picks: z.array(ReferencePickSchema),
  briefs: z.array(ReferenceBriefSchema),
});
export type DirectorReferences = z.infer<typeof DirectorReferencesSchema>;

const LABELS = ['A', 'B', 'C', 'D', 'E'];

/** `Reference A`, `Reference B`, … by pick order. */
export function referenceLabel(index: number): string {
  return `Reference ${LABELS[index] ?? String(index + 1)}`;
}

/**
 * The brief of one picked reference. `knownPatterns` drops a pattern id the registry no longer
 * has (a record from before a catalogue change), so the Director is never offered one.
 */
export function referenceBrief(
  record: ReferenceRecord,
  index: number,
  pick: ReferencePick,
  knownPatterns?: ReadonlySet<string>,
): ReferenceBrief {
  const keep = (id: string) => !knownPatterns || knownPatterns.has(id);
  return {
    label: referenceLabel(index),
    topicClass: record.topicClass,
    ...(record.secondaryTopicClass ? { secondaryTopicClass: record.secondaryTopicClass } : {}),
    format: record.format,
    ...(record.lengthSec !== undefined ? { lengthSec: record.lengthSec } : {}),
    whyPicked: whyPicked(pick),
    hook: `${record.hook.kind}/${record.hook.device}: ${record.hook.shape}`,
    arc: record.arc,
    videoDevices: record.videoDevices,
    beats: record.beats.map((beat) => {
      const ids = [
        ...(beat.devices.length > 0 ? [`devices ${beat.devices.join(', ')}`] : []),
        ...(beat.patterns.filter(keep).length > 0
          ? [`patterns ${beat.patterns.filter(keep).join(', ')}`]
          : []),
        ...(beat.layoutMode ? [`layout ${beat.layoutMode}`] : []),
        ...(beat.continuesPrevious ? ['continues the previous board'] : []),
      ];
      return `${beat.role}: ${beat.summary}${ids.length > 0 ? ` [${ids.join('; ')}]` : ''}`;
    }),
    pacing: record.pacing,
  };
}

/** The positive reasons, without their points: "class concept; devices failure_before_fix, …". */
function whyPicked(pick: ReferencePick): string {
  return pick.reasons
    .filter((r) => /\+[\d.]+$/.test(r))
    .map((r) => r.replace(/\s*\+[\d.]+$/, ''))
    .join('; ');
}
