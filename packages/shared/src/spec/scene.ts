import { z } from 'zod';
import { EventTargetSchema, OpenParamsSchema, SpecIdSchema } from './ids.ts';

/**
 * Scene layer, written by the Generator: one entry per story beat, in story order. Logical
 * content only; the layout engine computes every position and size.
 */

/** `world` (3D) is reserved for phase 2; the scene schema then becomes a discriminated union. */
export const SCENE_KINDS = ['board', 'world'] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

export const EVENT_ACTIONS = [
  'enter',
  'exit',
  'highlight',
  'dim',
  'focus',
  'move',
  'morph',
  'count',
  'lock',
  'reject',
  'pulse',
] as const;
export const EventActionSchema = z.enum(EVENT_ACTIONS);
export type EventAction = z.infer<typeof EventActionSchema>;

export const TRANSITIONS = ['cut', 'fade', 'zoom-in', 'zoom-out', 'slide'] as const;
export const TransitionSchema = z.enum(TRANSITIONS);
export type Transition = z.infer<typeof TransitionSchema>;

/** The n-th word (0-based) of this beat's narration, as split by `narrationWords`. */
export const WordIndexAnchorSchema = z.strictObject({
  type: z.literal('word'),
  index: z.number().int().min(0),
});

/** The n-th occurrence (1-based) of a word in this beat's narration; case and punctuation ignored. */
export const WordTextAnchorSchema = z.strictObject({
  type: z.literal('word_text'),
  text: z.string().regex(/^\S+$/, 'A single word, without spaces.'),
  occurrence: z.number().int().min(1).default(1),
});

export const BEAT_EDGES = ['start', 'end'] as const;

/** Beat start plus a non-negative offset, or beat end plus a non-positive offset. */
export const BeatEdgeAnchorSchema = z
  .strictObject({
    type: z.literal('beat'),
    edge: z.enum(BEAT_EDGES),
    offsetSec: z.number().default(0),
  })
  .refine((a) => (a.edge === 'start' ? a.offsetSec >= 0 : a.offsetSec <= 0), {
    message: 'Offsets count into the beat: >= 0 from the start, <= 0 from the end.',
    path: ['offsetSec'],
  });

export const EventAnchorSchema = z.discriminatedUnion('type', [
  WordIndexAnchorSchema,
  WordTextAnchorSchema,
  BeatEdgeAnchorSchema,
]);
export type EventAnchor = z.infer<typeof EventAnchorSchema>;

export const SceneElementSchema = z.strictObject({
  id: SpecIdSchema,
  /** Primitive registry id (validated by the registry, P1A.5). */
  primitive: SpecIdSchema,
  props: OpenParamsSchema.default({}),
  role: SpecIdSchema.optional(),
  zone: SpecIdSchema.optional(),
});
export type SceneElement = z.infer<typeof SceneElementSchema>;

export const ScenePatternSchema = z.strictObject({
  /** Instance id; events and focus may target it. */
  id: SpecIdSchema,
  /** Pattern registry id (validated by the registry, P1A.8). */
  pattern: SpecIdSchema,
  params: OpenParamsSchema.default({}),
});
export type ScenePattern = z.infer<typeof ScenePatternSchema>;

export const SceneEventSchema = z.strictObject({
  at: EventAnchorSchema,
  action: EventActionSchema,
  /**
   * Element or pattern instance ids in this beat (or, with `continuesPrevious`, earlier beats), or
   * `<instance>/<id>` for one element inside a pattern instance.
   */
  targets: z.array(EventTargetSchema).min(1),
  params: OpenParamsSchema.optional(),
});
export type SceneEvent = z.infer<typeof SceneEventSchema>;

export const BeatSceneSchema = z.strictObject({
  beatId: SpecIdSchema,
  kind: z.literal('board'),
  /**
   * Layout mode id (validated by the layout engine, P1A.9). Optional: without it the beat uses
   * its patterns' layout mode, else the default. An explicit mode always wins.
   */
  layoutMode: SpecIdSchema.optional(),
  elements: z.array(SceneElementSchema).default([]),
  patterns: z.array(ScenePatternSchema).default([]),
  events: z.array(SceneEventSchema).default([]),
  focus: z.array(SpecIdSchema).default([]),
  transitionIn: TransitionSchema.default('cut'),
  /** Keeps the previous beat's world and layout; this beat only adds or changes things in it. */
  continuesPrevious: z.boolean().default(false),
});
export type BeatScene = z.infer<typeof BeatSceneSchema>;

export const SceneLayerSchema = z.array(BeatSceneSchema).min(1);
export type SceneLayer = z.infer<typeof SceneLayerSchema>;
