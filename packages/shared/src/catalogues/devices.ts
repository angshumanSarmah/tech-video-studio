import { z } from 'zod';
import { catalogueSchema, defineCatalogue, DescribedFieldsSchema } from './schema.ts';

/**
 * Narrative devices: story techniques the Director picks for a video (`story.devices`) and for
 * single beats (`story.beats[].device`). Techniques only, never another video's look or wording.
 */

export const DEVICE_IDS = [
  'persona_hook',
  'contention_hook',
  'interview_hook',
  'planted_question',
  'question_chapters',
  'roadmap',
  'recap_opening',
  'hero_metric',
  'object_to_data',
  'failure_before_fix',
  'brute_force_first',
  'named_traps',
  'seen_this_bug',
  'ownership_twist',
  'race_reveal',
  'versus_split',
  'what_breaks',
  'counterfactual',
  'semantic_zoom',
  'real_incident',
  'real_world_closure',
  'contrast_takeaway',
  'callback_ending',
  'spec_card_ending',
  'cliffhanger_ending',
] as const;
export const DeviceIdSchema = z.enum(DEVICE_IDS);
export type DeviceId = z.infer<typeof DeviceIdSchema>;

/**
 * Devices a story may end on (`story.ending.kind`). A single video or the last part closes with
 * any but `cliffhanger_ending`; earlier parts of a multi-part video end on `cliffhanger_ending`.
 */
export const ENDING_DEVICES = [
  'spec_card_ending',
  'callback_ending',
  'real_world_closure',
  'cliffhanger_ending',
] as const satisfies readonly DeviceId[];
export type EndingDevice = (typeof ENDING_DEVICES)[number];

export const DeviceEntrySchema = DescribedFieldsSchema.extend({ id: DeviceIdSchema });
export type DeviceEntry = z.infer<typeof DeviceEntrySchema>;

export const DeviceCatalogueSchema = catalogueSchema('devices', DEVICE_IDS, DeviceEntrySchema);

export const DEVICE_CATALOGUE = defineCatalogue(DeviceCatalogueSchema, {
  id: 'devices',
  version: 1,
  entries: [
    {
      id: 'persona_hook',
      name: 'Persona hook',
      summary:
        'Open on one relatable person in an everyday moment that quietly depends on the system.',
      whenToUse: 'A user-facing product whose load or failure is felt by ordinary people.',
      whenNotToUse: 'Internals or pure concepts with no natural person in the story.',
    },
    {
      id: 'contention_hook',
      name: 'Contention hook',
      summary: 'Open on many contenders racing for one scarce resource at the same instant.',
      whenToUse: 'Locks, inventory, seats, slots, quotas: anything where many want one.',
      whenNotToUse: 'Nothing is scarce, or the contention is not the core problem.',
    },
    {
      id: 'interview_hook',
      name: 'Interview hook',
      summary: 'Open on the question an interviewer would ask about this topic, then answer it.',
      whenToUse: 'Classic system design or ML interview topics engineers revise for.',
      whenNotToUse: 'Niche internals nobody is asked about; use a number-led hook instead.',
    },
    {
      id: 'planted_question',
      name: 'Planted question, late payoff',
      summary:
        'Raise a question early, leave it open, answer it near the end. Fill `plantedQuestion`.',
      whenToUse: 'The topic has one non-obvious "but how?" that the mechanism finally explains.',
      whenNotToUse: 'The answer is needed early to follow the rest, or the video is very short.',
    },
    {
      id: 'question_chapters',
      name: 'Question-driven chapters',
      summary: 'Each chapter is titled as a question the viewer would ask; the chapter answers it.',
      whenToUse: 'Two to four distinct sub-problems that each deserve a heading.',
      whenNotToUse: 'One continuous mechanism; a roadmap or no chapters reads better.',
    },
    {
      id: 'roadmap',
      name: 'Roadmap of steps',
      summary: 'Show the numbered steps up front, then walk through them with a step tracker.',
      whenToUse: 'A process with a fixed order of 3 to 7 steps.',
      whenNotToUse: 'The order is the surprise, or there are fewer than 3 steps.',
    },
    {
      id: 'recap_opening',
      name: 'Recap opening',
      summary: 'Open a later part with a recap of at most two sentences, then its own hook.',
      whenToUse: 'Part 2 or later of a multi-part video.',
      whenNotToUse: 'A single video or part 1.',
    },
    {
      id: 'hero_metric',
      name: 'Hero metric / story clock',
      summary:
        'Pin one number for the whole video, optionally a running clock in story time. Fill `heroMetric`.',
      whenToUse: 'One latency, deadline or budget that every step spends from.',
      whenNotToUse: 'No single number ties the steps together.',
    },
    {
      id: 'object_to_data',
      name: 'Object-to-data morph',
      summary: 'A real-world thing turns into the record or message the system actually sees.',
      whenToUse: 'The first time a physical event becomes data (a scan, a tap, a sensor reading).',
      whenNotToUse: 'Everything in the story is already data.',
    },
    {
      id: 'failure_before_fix',
      name: 'Failure before fix',
      summary: 'Show the naive design breaking under load or at an edge, then the fix.',
      whenToUse: 'The fix only makes sense once the failure is seen.',
      whenNotToUse: 'There is no plausible naive design to break.',
    },
    {
      id: 'brute_force_first',
      name: 'Brute force before clever fix',
      summary:
        'Do it the slow obvious way first, show the cost, then the structure that avoids it.',
      whenToUse: 'An index, a hash, a grid or a cache replaces a scan over everything.',
      whenNotToUse: 'The obvious way is not actually slow at the scale in the notes.',
    },
    {
      id: 'named_traps',
      name: 'Named traps',
      summary: 'Give each edge case a short memorable name and show it one at a time.',
      whenToUse: 'Two or three distinct edge cases the design must survive.',
      whenNotToUse: 'Only one edge case; show it as failure before fix instead.',
    },
    {
      id: 'seen_this_bug',
      name: "You've seen this bug",
      summary: 'Start from a glitch the viewer has met as a user, then explain what caused it.',
      whenToUse:
        'A familiar symptom (stale count, double charge, vanished item) maps to the mechanism.',
      whenNotToUse: 'The symptom is invisible to users.',
    },
    {
      id: 'ownership_twist',
      name: 'Ownership twist',
      summary: 'Reveal that the data or decision is owned by a different system than assumed.',
      whenToUse: 'The source of truth is surprising and changes how the design works.',
      whenNotToUse: 'Ownership is obvious or irrelevant to the mechanism.',
    },
    {
      id: 'race_reveal',
      name: 'Race reveal (two clocks)',
      summary: 'Two timers run at once and the outcome depends on which ends first.',
      whenToUse: 'Timeouts, leases, holds and retries racing each other.',
      whenNotToUse: 'Only one timer matters.',
    },
    {
      id: 'versus_split',
      name: 'Versus split',
      summary: 'Two designs or outcomes for the same situation, side by side.',
      whenToUse: 'A trade-off between two named options with the same input.',
      whenNotToUse: 'More than two options, or the options share nothing to compare.',
    },
    {
      id: 'what_breaks',
      name: 'What-breaks simulation',
      summary: 'Remove or overload one part and show step by step what fails downstream.',
      whenToUse: 'Explaining why a component exists by taking it away.',
      whenNotToUse: 'Nothing visible fails; the cost is only slower in a way not shown.',
    },
    {
      id: 'counterfactual',
      name: 'Counterfactual ("what if")',
      summary: 'Show what would happen with a different choice, with its cost, then return.',
      whenToUse: 'A tempting alternative whose cost is concrete (time, money, errors).',
      whenNotToUse: 'The alternative is already the failure before fix; do not show it twice.',
    },
    {
      id: 'semantic_zoom',
      name: 'Semantic zoom',
      summary: 'Push into one component of the board to reveal its insides on the next board.',
      whenToUse: 'Going from the whole system to the one part that does the work.',
      whenNotToUse: 'The inside is not worth a board of its own.',
    },
    {
      id: 'real_incident',
      name: 'Real incident case study',
      summary: 'Concept first, then a real dated outage from the notes, with its source shown.',
      whenToUse: 'The notes hold an incident with a date and a publisher.',
      whenNotToUse: 'The notes have no sourced incident; never invent or blur one.',
    },
    {
      id: 'real_world_closure',
      name: 'Real-world closure',
      summary: 'End on the physical moment where the system finally touches the user.',
      whenToUse: 'A flow that starts digital and ends in the real world.',
      whenNotToUse: 'The result never leaves the screen.',
    },
    {
      id: 'contrast_takeaway',
      name: 'Two-line contrast takeaway',
      summary: 'Close a section on two short lines: what is easy, and what is actually hard.',
      whenToUse: 'The core insight is a contrast the viewer should repeat.',
      whenNotToUse: 'The insight is a single fact, not a contrast.',
    },
    {
      id: 'callback_ending',
      name: 'Callback ending + share CTA',
      summary:
        'Return to the opening image or person with the problem now solved, then a share line.',
      whenToUse: 'The hook had a person or image worth coming back to.',
      whenNotToUse: 'The hook was a bare number with nothing to call back to.',
    },
    {
      id: 'spec_card_ending',
      name: 'Spec card ending',
      summary: 'End on a 3-line spec card summarising the design, plus the series number.',
      whenToUse: 'The last part of every video: the house ending. Combine with a callback if used.',
      whenNotToUse: 'Earlier parts of a multi-part video; they end on a cliffhanger.',
    },
    {
      id: 'cliffhanger_ending',
      name: 'Cliffhanger ending',
      summary: "End an earlier part on a line that names the next part's question, unanswered.",
      whenToUse: 'Every part but the last of a multi-part video.',
      whenNotToUse: 'A single video or the last part.',
    },
  ],
});
