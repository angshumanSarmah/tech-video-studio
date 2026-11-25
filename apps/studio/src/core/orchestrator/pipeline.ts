import {
  PIPELINE_STEP_IDS,
  type GateId,
  type PipelineStepId,
  type Stage,
} from '@explainer-studio/shared';

/**
 * The orchestrator's table (P1C.9): what each pipeline step is. `decide` reads only this and a
 * run's snapshot; adding a step is a row here (and its id in `PIPELINE_STEP_IDS`).
 */

/** Which spec version a job step renders or reads (its payload's `specVersionId`). */
export type JobVersion =
  /** No spec version: the job reads the run's steps. */
  | 'none'
  /** The run's newest version. */
  | 'latest'
  /** The version the Curator ended on (`report.final`). */
  | 'curated'
  /** The version the scenes gate approved. */
  | 'approved_scenes'
  /** The version the draft gate approved. */
  | 'approved_draft';

export type StepDefinition =
  | {
      readonly kind: 'job';
      readonly jobType: string;
      readonly stage: Stage;
      readonly version: JobVersion;
      /** Extra payload fields. */
      readonly payload?: Readonly<Record<string, unknown>>;
      /** A failed job does not stop the run (its handler does not fail the run either). */
      readonly mayFail?: boolean;
    }
  | { readonly kind: 'gate'; readonly gate: GateId }
  /** A transition code makes between steps (spec assembly, backlog, parts). */
  | { readonly kind: 'effect' }
  /** A parent of a multi-part video waits here for its parts. */
  | { readonly kind: 'children' }
  | { readonly kind: 'end' };

const job = (
  jobType: string,
  stage: Stage,
  version: JobVersion,
  extra: Partial<Pick<Extract<StepDefinition, { kind: 'job' }>, 'payload' | 'mayFail'>> = {},
): StepDefinition => ({ kind: 'job', jobType, stage, version, ...extra });

export const PIPELINE: Readonly<Record<PipelineStepId, StepDefinition>> = {
  ingest: job('ingest', 'ingest', 'none'),
  research: job('research', 'research', 'none'),
  gate_research: { kind: 'gate', gate: 'research' },
  direct: job('direct', 'direct', 'none'),
  gate_beat_sheet: { kind: 'gate', gate: 'beat_sheet' },
  split: { kind: 'effect' },
  children: { kind: 'children' },
  script: job('script', 'script', 'none'),
  spec: { kind: 'effect' },
  tts: job('tts', 'tts', 'latest'),
  generate: job('generate', 'generate', 'latest'),
  board_backlog: { kind: 'effect' },
  retime: job('tts', 'tts', 'latest'),
  repair: job('repair', 'repair', 'latest'),
  curate: job('curate', 'curate', 'latest', { payload: { repair: true } }),
  stills: job('render_stills', 'draft_render', 'curated', { mayFail: true }),
  gate_scenes: { kind: 'gate', gate: 'scenes' },
  draft: job('render_draft', 'draft_render', 'approved_scenes'),
  gate_draft: { kind: 'gate', gate: 'draft' },
  final: job('render_final', 'final_render', 'approved_draft'),
  done: { kind: 'end' },
};

/**
 * Steps the pipeline never passes through on its own: `children` is entered only by a split with
 * parts, `repair` only by a gate's "regenerate beat".
 */
const ENTERED_EXPLICITLY: ReadonlySet<PipelineStepId> = new Set(['children', 'repair']);

/** The step after `step` in pipeline order. */
export function nextStep(step: PipelineStepId): PipelineStepId {
  for (let i = PIPELINE_STEP_IDS.indexOf(step) + 1; i < PIPELINE_STEP_IDS.length; i += 1) {
    const id = PIPELINE_STEP_IDS[i]!;
    if (!ENTERED_EXPLICITLY.has(id)) return id;
  }
  return 'done';
}

/** Whether `step` comes after `than` in pipeline order. */
export const isAfter = (step: PipelineStepId, than: PipelineStepId): boolean =>
  PIPELINE_STEP_IDS.indexOf(step) > PIPELINE_STEP_IDS.indexOf(than);

/** The pipeline step of each gate. */
export const GATE_STEPS: Readonly<Record<GateId, PipelineStepId>> = {
  research: 'gate_research',
  beat_sheet: 'gate_beat_sheet',
  scenes: 'gate_scenes',
  draft: 'gate_draft',
};
