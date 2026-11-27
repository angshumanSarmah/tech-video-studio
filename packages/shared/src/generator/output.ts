import { z } from 'zod';
import { EventTargetSchema, OpenParamsSchema, SpecIdSchema } from '../spec/ids.ts';
import {
  EventActionSchema,
  SceneElementSchema,
  TransitionSchema,
  WordIndexAnchorSchema,
  type BeatScene,
} from '../spec/scene.ts';
import { MissingAssetRequestSchema } from '../domain/assets.ts';
import { MissingPrimitiveRequestSchema, type StoryBeat } from '../spec/story.ts';

/**
 * The Generator's output (P1C.7): one beat's board, without what the approved plan already
 * decides (`beatId`, `continuesPrevious`, `layoutMode`; code adds them with `generatorScene`).
 * Stricter than `BeatSceneSchema`: every anchor, in events and in a pattern's `params.at`, is a
 * word index into the beat's numbered narration words, so there is one way to anchor. Pattern
 * params are otherwise checked by the pattern registry. Descriptions reach the model through the
 * output JSON Schema, so they are written to it.
 */

export const GeneratorAnchorSchema = WordIndexAnchorSchema.describe(
  "The 0-based index of a word in this beat's numbered narration words.",
);

export const GeneratorPatternSchema = z.strictObject({
  id: SpecIdSchema.describe('Instance id, unique on the board; events and focus may target it.'),
  pattern: SpecIdSchema.describe('A pattern id from the PATTERNS list.'),
  params: z
    .looseObject({
      at: z
        .record(z.string(), GeneratorAnchorSchema)
        .optional()
        .describe("One word anchor per name in the pattern's anchors."),
    })
    .describe("The pattern's params, as its params schema in the PATTERNS list states them."),
});

export const GeneratorEventSchema = z.strictObject({
  at: GeneratorAnchorSchema,
  action: EventActionSchema,
  targets: z
    .array(EventTargetSchema)
    .min(1)
    .describe(
      'Ids on this board (or ON SCREEN), or "<example-instance>/<example-element>" for one element inside a pattern.',
    ),
  params: OpenParamsSchema.optional().describe(
    'Optional: "parts" (with exactly one target), "hold" (highlight only) or "stagger": "scan".',
  ),
});

export const GeneratorOutputSchema = z.strictObject({
  elements: z
    .array(SceneElementSchema)
    .default([])
    .describe('Primitives this beat adds. Never declare an id that is already ON SCREEN.'),
  patterns: z.array(GeneratorPatternSchema).default([]).describe('Patterns this beat adds.'),
  events: z
    .array(GeneratorEventSchema)
    .default([])
    .describe('What changes on screen, each on the word where the narration says it.'),
  focus: z
    .array(SpecIdSchema)
    .default([])
    .describe(
      'The one thing to watch: element or pattern ids, never an inner "<example-instance>/<example-element>".',
    ),
  transitionIn: TransitionSchema.default('cut').describe(
    'How a new board comes in; leave it out on a beat that continues the previous board.',
  ),
  zoomFrom: EventTargetSchema.optional().describe(
    'With "zoom-in" on a semantic_zoom beat only: the element of the previous board to zoom into.',
  ),
  missingPrimitiveRequests: z
    .array(MissingPrimitiveRequestSchema)
    .optional()
    .describe('Only when no primitive, pattern or asset fits: what you needed and what you used.'),
  missingAssetRequests: z
    .array(MissingAssetRequestSchema)
    .optional()
    .describe(
      'Only when no listed asset shows the thing: one entry for the new asset id this board uses (at most one per beat).',
    ),
});
export type GeneratorOutput = z.infer<typeof GeneratorOutputSchema>;

/**
 * The beat's scene: the Generator's board plus what the plan decides. A continuing beat keeps
 * the previous board's layout, so only a board's first beat takes the plan's layout mode (none
 * means its first pattern's). `missingPrimitiveRequests` are not part of the scene;
 * `missingAssetRequests` are (they describe placeholder ids on this board).
 */
export function generatorScene(
  output: GeneratorOutput,
  beat: Pick<StoryBeat, 'id' | 'continuesPrevious' | 'layoutMode'>,
): BeatScene {
  const { elements, patterns, events, focus, transitionIn, zoomFrom, missingAssetRequests } =
    output;
  const layoutMode = beat.continuesPrevious ? undefined : beat.layoutMode;
  return {
    beatId: beat.id,
    kind: 'board',
    ...(layoutMode ? { layoutMode } : {}),
    elements,
    patterns,
    events,
    focus,
    transitionIn,
    ...(zoomFrom ? { zoomFrom } : {}),
    continuesPrevious: beat.continuesPrevious,
    ...(missingAssetRequests?.length ? { missingAssetRequests } : {}),
  };
}
