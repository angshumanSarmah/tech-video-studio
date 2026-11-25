import { withRegistryChecks } from '@explainer-studio/renderer/catalog';
import {
  citableChunks,
  DirectorPlanSchema,
  remapAnchors,
  researchNotesProblems,
  ResearchNotesSchema,
  toJsonPath,
  validateVideoSpec,
  VideoSpecShapeSchema,
  type GateId,
  type GateIssue,
  type GateSubjectDto,
  type Stage,
  type VideoSpec,
} from '@explainer-studio/shared';
import type { z } from 'zod';
import { planIssues } from '../checks/plan.ts';
import { directPlanPath, researchNotesPath, writeDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { markCarried } from '../db/repositories/gates.ts';
import {
  finishRunStep,
  setRunStepInput,
  startRunStep,
  type RunStep,
} from '../db/repositories/run-steps.ts';
import type { Run } from '../db/repositories/runs.ts';
import { InvalidEditError } from '../errors.ts';
import { advanceRun, moveTo } from '../orchestrator/advance.ts';
import { OrchestratorStateError } from '../orchestrator/snapshot.ts';
import { latestDirection } from './direction.ts';
import { currentSubject, planDeps, readSpecVersion, subjectDto } from './gates.ts';
import { latestResearch } from './research-notes.ts';
import { saveSpecVersionIn } from './spec-versions.ts';

/**
 * A user's edit at a gate (P1C.9 step 4), in the decision's transaction. The edited subject must
 * pass its schema (else `InvalidEditError`, nothing saved); it is saved as the user's new step
 * (research notes, beat sheet) or spec version (scenes, draft), and its checks run again: the
 * research and plan checks here, returned with the edit; for a spec, the Curator's, through the
 * `edit_` steps (TTS first when narration changed). An edit identical to the subject saves nothing.
 */

export interface EditOutcome {
  readonly saved: GateSubjectDto | null;
  readonly issues: GateIssue[];
}

export function editAtGate(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  content: unknown,
): EditOutcome {
  switch (gate) {
    case 'research':
      return editResearch(tx, dataDir, run, content);
    case 'beat_sheet':
      return editPlan(tx, dataDir, run, content);
    case 'scenes':
    case 'draft':
      return editSpec(tx, dataDir, run, gate, content);
  }
}

function editResearch(tx: Executor, dataDir: string, run: Run, content: unknown): EditOutcome {
  const notes = parseOrThrow(ResearchNotesSchema, content, 'research notes');
  const current = latestResearch(tx, dataDir, run.id);
  if (!current) throw new OrchestratorStateError(`Run ${run.id} has no research to edit.`);
  if (sameJson(current.notes, notes)) return { saved: null, issues: [] };
  const step = userStep(tx, run, 'research', current.step, (id) =>
    writeDataJson(dataDir, researchNotesPath(run.id, id), notes),
  );
  advanceRun(tx, dataDir, run.id);
  return {
    saved: { kind: 'step', id: step.id },
    issues: researchNotesProblems(notes, citableChunks(current.input)).map(plain),
  };
}

function editPlan(tx: Executor, dataDir: string, run: Run, content: unknown): EditOutcome {
  const plan = parseOrThrow(DirectorPlanSchema, content, 'beat sheet');
  const current = latestDirection(tx, dataDir, run.id);
  if (!current) throw new OrchestratorStateError(`Run ${run.id} has no beat sheet to edit.`);
  if (sameJson(current.plan, plan)) return { saved: null, issues: [] };
  const step = userStep(tx, run, 'direct', current.step, (id) =>
    writeDataJson(dataDir, directPlanPath(run.id, id), plan),
  );
  const issues = planIssues(plan, planDeps(tx, dataDir, run, current.input));
  advanceRun(tx, dataDir, run.id);
  return { saved: { kind: 'step', id: step.id }, issues };
}

/**
 * The user's step at `stage`: finished, reading what the step it replaces read (same input
 * file), its output written by `write` once the step has an id.
 */
function userStep(
  tx: Executor,
  run: Run,
  stage: Stage,
  replaces: RunStep,
  write: (stepId: number) => string,
): RunStep {
  const step = startRunStep(tx, { runId: run.id, stage, createdBy: 'user' });
  if (replaces.inputPath) setRunStepInput(tx, step.id, replaces.inputPath);
  return finishRunStep(tx, step.id, write(step.id));
}

function editSpec(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: 'scenes' | 'draft',
  content: unknown,
): EditOutcome {
  const subject = currentSubject(tx, dataDir, run, gate);
  const before = subject?.specVersionId && readSpecVersion(tx, dataDir, subject.specVersionId);
  if (!before) throw new OrchestratorStateError(`Run ${run.id} has no spec at the ${gate} gate.`);
  const edit = prepareSpecEdit(before, content, run.resolvedSettings.timing.landingSec);
  const saved = saveSpecVersionIn(tx, dataDir, {
    runId: run.id,
    spec: edit.spec,
    createdBy: 'user',
    note: `Edited at the ${gate} gate.`,
  });
  if (!saved.created) return { saved: null, issues: edit.issues };
  if (gate === 'draft') markCarried(tx, run.id, 'scenes', 'draft');
  moveTo(tx, run, edit.retime ? 'edit_retime' : 'edit_curate');
  advanceRun(tx, dataDir, run.id);
  return { saved: subjectDto(tx, { specVersionId: saved.version.id }), issues: edit.issues };
}

export interface SpecEdit {
  /** The edited spec, valid; its timing dropped when narration changed (TTS times it again). */
  readonly spec: VideoSpec;
  /** TTS runs again before the Curator: narration changed, or a board while holds are on. */
  readonly retime: boolean;
  /** Validation warnings, and anchors a narration change left on the old words. */
  readonly issues: GateIssue[];
}

/**
 * Pure: the edited spec against the one it edits. A beat whose narration changed and whose board
 * did not has its word anchors moved onto the new words (`remapAnchors`); when some cannot move,
 * the board is kept as edited and they are reported. A spec that fails validation is refused.
 */
export function prepareSpecEdit(before: VideoSpec, content: unknown, landingSec: number): SpecEdit {
  const edited = parseOrThrow(VideoSpecShapeSchema, content, 'spec');
  const narrationChanged = changedNarrations(before, edited);
  const { spec, lost } = remapBoards(before, edited, narrationChanged);
  const timed = retimed(spec, narrationChanged.size > 0);
  const result = withRegistryChecks(validateVideoSpec(timed), timed);
  if (!result.ok) {
    throw new InvalidEditError(
      'The edited spec is not valid; nothing was saved.',
      result.errors.map((e) => ({ path: e.path, message: `${e.code}: ${e.message}` })),
    );
  }
  const boardsChanged = !sameJson(before.scenes ?? [], edited.scenes ?? []);
  return {
    spec: result.spec,
    retime: narrationChanged.size > 0 || (landingSec > 0 && boardsChanged),
    issues: [...result.warnings.map(plain), ...lost],
  };
}

/** Beats whose narration the edit changed. */
function changedNarrations(before: VideoSpec, after: VideoSpec): Set<string> {
  const old = new Map((before.script ?? []).map((b) => [b.beatId, b.narration]));
  return new Set(
    (after.script ?? []).filter((b) => old.get(b.beatId) !== b.narration).map((b) => b.beatId),
  );
}

function remapBoards(
  before: VideoSpec,
  edited: VideoSpec,
  changed: ReadonlySet<string>,
): { spec: VideoSpec; lost: GateIssue[] } {
  if (!edited.scenes || changed.size === 0) return { spec: edited, lost: [] };
  const narration = (spec: VideoSpec, beatId: string) =>
    spec.script?.find((b) => b.beatId === beatId)?.narration ?? '';
  const lost: GateIssue[] = [];
  const scenes = edited.scenes.map((scene, i) => {
    const old = before.scenes?.find((s) => s.beatId === scene.beatId);
    if (!changed.has(scene.beatId) || !old || !sameJson(old, scene)) return scene;
    const remap = remapAnchors(
      scene,
      narration(before, scene.beatId),
      narration(edited, scene.beatId),
    );
    if (remap.ok) return remap.scene;
    lost.push(
      ...remap.lost.map((l) => ({
        path: toJsonPath(['scenes', i, ...l.path]),
        code: 'anchor_word_removed',
        message: `This anchor was on "${l.word}", which the new narration no longer says: it stays on the same word index.`,
      })),
    );
    return scene;
  });
  return { spec: { ...edited, scenes }, lost };
}

/**
 * The timing layer the edit keeps: none when narration changed (TTS times it again), else the
 * one it had with the event cache dropped (it belongs to the boards it was timed with).
 */
function retimed(spec: VideoSpec, narrationChanged: boolean): VideoSpec {
  if (!spec.timing) return spec;
  if (narrationChanged) {
    const untimed = { ...spec };
    delete untimed.timing;
    return untimed;
  }
  return { ...spec, timing: { ...spec.timing, events: [] } };
}

function parseOrThrow<S extends z.ZodType>(schema: S, content: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(content);
  if (parsed.success) return parsed.data;
  throw new InvalidEditError(
    `The edit does not match the ${what} schema; nothing was saved.`,
    parsed.error.issues.map((i) => ({ path: toJsonPath(i.path), message: i.message })),
  );
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const plain = (issue: { path: string; code: string; message: string }): GateIssue => ({
  path: issue.path,
  code: issue.code,
  message: issue.message,
});
