import { z } from 'zod';

/**
 * The run orchestrator's steps (P1C.9), in pipeline order: each is a job, a review gate, or a
 * transition code makes between them. A run's `pipeline_step` is where it is. Exhaustive.
 *
 * - `split`: after the beat-sheet gate, a plan with parts becomes child runs (the parent then
 *   waits at `children`); a plan without parts goes on to `script`.
 * - `spec`: the plan and the script assembled into the run's next spec version.
 * - `board_backlog`: the Generator's missing-primitive requests recorded in the backlog.
 * - `retime`: TTS again on the boards' version (cache hits), adding the landing holds.
 * - `repair`: entered only from a gate's "regenerate beat" (P1C.9 step 5), never in passing.
 * - `stills` render before the scenes gate, so it shows a still per beat.
 */
export const PIPELINE_STEP_IDS = [
  'ingest',
  'research',
  'gate_research',
  'direct',
  'gate_beat_sheet',
  'split',
  'children',
  'script',
  'spec',
  'tts',
  'generate',
  'board_backlog',
  'retime',
  'repair',
  'curate',
  'stills',
  'gate_scenes',
  'draft',
  'gate_draft',
  'final',
  'done',
] as const;
export const PipelineStepIdSchema = z.enum(PIPELINE_STEP_IDS);
export type PipelineStepId = z.infer<typeof PipelineStepIdSchema>;
