import { z } from 'zod';
import { DeviceIdSchema, type DeviceId } from '../catalogues/devices.ts';
import { LayoutModeIdSchema } from '../catalogues/layout-modes.ts';
import { MetaphorWorldIdSchema } from '../catalogues/metaphor-worlds.ts';
import { SpecIdSchema } from '../spec/ids.ts';
import { TopicClassSchema, VideoFormatSchema } from '../spec/meta.ts';
import { HookKindSchema } from '../spec/story.ts';

/**
 * A reference video's structure (P1C.11): how a video someone admires is built, mapped onto our
 * catalogue, so the Director can borrow a technique. Structure only: no on-screen wording,
 * titles, numbers or names, which go to `namesToAvoid` (read only by code, never by a model).
 * The Reference analyst writes it from a pasted breakdown (`referenceRecordProblems` checks it);
 * the six seeds are committed in `apps/studio/seed/references/`. Pure.
 */

/** One line of plain text (no line breaks). */
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\r\n]*$/, 'Keep it on one line.');

/** What a beat does in the story. */
export const REFERENCE_BEAT_ROLES = [
  'hook',
  'setup',
  'step',
  'trap',
  'twist',
  'payoff',
  'takeaway',
  'ending',
] as const;
export const ReferenceBeatRoleSchema = z.enum(REFERENCE_BEAT_ROLES);
export type ReferenceBeatRole = z.infer<typeof ReferenceBeatRoleSchema>;

/**
 * Devices that span the whole video (a pinned metric, a roadmap, chapter headers): listed in
 * `videoDevices`, never on one beat.
 */
export const WHOLE_VIDEO_DEVICES = [
  'hero_metric',
  'roadmap',
  'question_chapters',
] as const satisfies readonly DeviceId[];

export const MAX_REFERENCE_BEATS = 12;
export const MAX_NAMES_TO_AVOID = 15;

export const ReferenceBeatSchema = z.strictObject({
  role: ReferenceBeatRoleSchema,
  summary: oneLine(160).describe(
    'One plain sentence on what happens structurally, in your own words; no digits, no names.',
  ),
  devices: z.array(DeviceIdSchema).max(3).default([]),
  patterns: z
    .array(SpecIdSchema)
    .max(3)
    .default([])
    .describe('Pattern ids from the catalogue that would draw this beat.'),
  primitives: z
    .array(SpecIdSchema)
    .max(5)
    .default([])
    .describe('Primitive ids from the catalogue that would draw this beat.'),
  layoutMode: LayoutModeIdSchema.optional(),
  continuesPrevious: z
    .boolean()
    .default(false)
    .describe('True when the beat keeps the previous beat’s board and adds to it.'),
});
export type ReferenceBeat = z.infer<typeof ReferenceBeatSchema>;

export const ReferenceChapterSchema = z.strictObject({
  beats: z
    .array(z.number().int().min(0))
    .min(1)
    .describe('Indexes into beats (from 0) of the chapter’s beats, in order.'),
  questionForm: z.boolean().describe('True when the chapter header is a question.'),
});

/** How buildable a missing item is: now, later (3D, live footage), or never (a creator's signature). */
export const UNMAPPED_BUILDABLE = ['yes', 'phase_2', 'no'] as const;
export const UNMAPPED_KINDS = [
  'device',
  'pattern',
  'primitive',
  'layout_mode',
  'format',
  'other',
] as const;

export const UnmappedItemSchema = z.strictObject({
  kind: z.enum(UNMAPPED_KINDS),
  name: SpecIdSchema.describe('A short snake_case name for what is missing.'),
  description: oneLine(160).describe('One line on what it shows.'),
  closest: SpecIdSchema.optional().describe('The closest primitive or pattern id we have.'),
  buildable: z
    .enum(UNMAPPED_BUILDABLE)
    .describe(
      'yes: we could build it; phase_2: 3D, live footage or picture-in-picture; no: a creator’s signature style.',
    ),
});
export type UnmappedItem = z.infer<typeof UnmappedItemSchema>;

export const AVOID_NAME_KINDS = ['brand', 'person', 'title', 'example', 'phrase'] as const;
export const AvoidNameKindSchema = z.enum(AVOID_NAME_KINDS);
export type AvoidNameKind = z.infer<typeof AvoidNameKindSchema>;

/** A name only code reads: a plan or script reusing it copies the reference. */
export const AvoidNameSchema = z.strictObject({
  text: oneLine(60),
  kind: AvoidNameKindSchema,
});
export type AvoidName = z.infer<typeof AvoidNameSchema>;

export const ReferenceRecordSchema = z.strictObject({
  title: oneLine(80).describe(
    'The topic in generic words (never the video’s title), e.g. "<example-generic-topic>".',
  ),
  series: z
    .array(SpecIdSchema)
    .min(1)
    .max(2)
    .describe('Series tags the video fits: "system-design", "ai" or both.'),
  topicClass: TopicClassSchema,
  secondaryTopicClass: TopicClassSchema.optional().describe(
    'A second class when part of the video is another kind (a product with a model step: ai-ml).',
  ),
  format: VideoFormatSchema,
  lengthSec: z
    .number()
    .int()
    .min(10)
    .max(600)
    .optional()
    .describe('How long it runs, only when the breakdown states a length; otherwise leave it out.'),
  hook: z.strictObject({
    kind: HookKindSchema,
    device: DeviceIdSchema.describe('The device the hook beat uses.'),
    shape: oneLine(160).describe('One line on how the hook creates tension; no digits, no names.'),
  }),
  arc: oneLine(160).describe('The whole structure on one line, e.g. "hook → steps → payoff".'),
  videoDevices: z
    .array(DeviceIdSchema)
    .max(4)
    .default([])
    .describe('Devices that span the whole video: hero_metric, roadmap, question_chapters.'),
  beats: z.array(ReferenceBeatSchema).min(3).max(MAX_REFERENCE_BEATS),
  metaphorWorld: MetaphorWorldIdSchema.nullable().default(null),
  chapters: z.array(ReferenceChapterSchema).max(6).default([]),
  pacing: z.array(oneLine(120)).max(3).default([]).describe('Up to three one-line pacing notes.'),
  unmapped: z.array(UnmappedItemSchema).max(12).default([]),
  namesToAvoid: z
    .array(AvoidNameSchema)
    .max(MAX_NAMES_TO_AVOID)
    .default([])
    .describe(
      'Every brand, product, company, app, person or channel name, the video’s title and any distinctive example or catchphrase.',
    ),
});
export type ReferenceRecord = z.infer<typeof ReferenceRecordSchema>;

/** The record's devices in order of first use: whole-video devices, then each beat's. */
export function referenceDevices(record: ReferenceRecord): DeviceId[] {
  const devices = [
    record.hook.device,
    ...record.videoDevices,
    ...record.beats.flatMap((b) => b.devices),
  ];
  return [...new Set(devices)];
}

/**
 * `videoDevices` without any device a beat carries: a device on a beat belongs to that beat, so
 * listing it as whole-video too tells the Director it spans the video (P1C.11 R2: the analyst
 * put `planted_question` and `persona_hook` there). Applied when a record is saved.
 */
export function withoutBeatDevicesInVideoDevices(record: ReferenceRecord): ReferenceRecord {
  const onBeats = new Set(record.beats.flatMap((b) => b.devices));
  const videoDevices = record.videoDevices.filter((d) => !onBeats.has(d));
  return videoDevices.length === record.videoDevices.length ? record : { ...record, videoDevices };
}

/** Every pattern the beats use, in order of first use. */
export function referencePatterns(record: ReferenceRecord): string[] {
  return [...new Set(record.beats.flatMap((b) => b.patterns))];
}

/** Every primitive the beats use, in order of first use. */
export function referencePrimitives(record: ReferenceRecord): string[] {
  return [...new Set(record.beats.flatMap((b) => b.primitives))];
}

/** Unmapped items that go to the backlog: buildable now or in phase 2. */
export function backlogItems(record: ReferenceRecord): UnmappedItem[] {
  return record.unmapped.filter((item) => item.buildable !== 'no');
}

/** Names merged without duplicates (case and spaces aside), first spelling kept. */
export function mergeAvoidNames(...lists: readonly (readonly AvoidName[])[]): AvoidName[] {
  const seen = new Set<string>();
  const merged: AvoidName[] = [];
  for (const name of lists.flat()) {
    const key = name.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(name);
  }
  return merged;
}
