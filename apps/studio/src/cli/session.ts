import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackAbout, type FixField, type GateId } from '@explainer-studio/shared';
import { resolveDataPath, runDir, writeDataJson } from '#core/data-files.ts';
import { listRunExports } from '#core/db/repositories/exports.ts';
import { runCostByRole } from '#core/db/repositories/llm-calls.ts';
import { getRunSummary, listPartRuns } from '#core/db/repositories/runs.ts';
import { ConflictError, InvalidEditError, InvalidProposalError } from '#core/errors.ts';
import { RegenerateNotAllowedError } from '#core/orchestrator/decide.ts';
import { videoCostUsd } from '#core/services/budget.ts';
import { decideAtGate, type GateDecision } from '#core/services/gate-decisions.ts';
import { regenerateAgents } from '#core/services/gate-regenerate.ts';
import { readGate, type GateView } from '#core/services/gates.ts';
import type { GateAction } from './args.ts';
import { CliError, EXIT, type CliContext } from './context.ts';
import { followRun, runLabel, type FollowCursors, type FollowEnd } from './follow.ts';
import { FIELDS_PROMPT, GATE_PROMPT, parseFieldsAnswer, parseGateReply } from './gate-reply.ts';
import { settleProposals, type PendingProposal } from './proposals.ts';
import { runMissingAssets } from '#core/services/missing-assets.ts';
import { gateCommands, gateSummary } from './summaries.ts';

/**
 * Drives a run from the terminal (P1C.9b): follows it, and at each gate prints the summary.
 * With a terminal it asks what to do and goes on; without one it prints the exact commands and
 * stops (the run waits). Returns the exit code.
 */
export async function driveRun(
  ctx: CliContext,
  rootId: number,
  after: number,
  proposals: readonly PendingProposal[] = [],
): Promise<number> {
  const cursors: FollowCursors = new Map();
  const pending = [...proposals];
  for (;;) {
    const end = await followRun(ctx, rootId, cursors, after);
    // The run stopped (a gate, or the end): proposal jobs queued with a decision run now.
    await settleProposals(ctx, pending.splice(0));
    if (end.kind !== 'gate') return finish(ctx, end);
    const view = readGate(ctx.db, ctx.config.dataDir, end.runId, end.gate);
    const missing =
      end.gate === 'scenes' || end.gate === 'draft'
        ? runMissingAssets(ctx.db, ctx.config.dataDir, end.runId).items
        : [];
    for (const line of gateSummary(view, ctx.config.dataDir, missing)) ctx.io.out(line);
    const editFile = writeEditFile(ctx, view);
    const decided = ctx.io.isTTY ? await askAtGate(ctx, view, editFile) : null;
    if (!decided) {
      for (const line of gateCommands(end.runId, end.gate, editFile)) ctx.io.out(line);
      return EXIT.ok;
    }
    if (decided.proposal) pending.push(decided.proposal);
  }
}

/** A decision made at the prompt, with the proposal it queued. */
interface Decided {
  readonly proposal: PendingProposal | undefined;
}

/** The prompt until a decision is made, or null when the user quits. */
async function askAtGate(
  ctx: CliContext,
  view: GateView,
  editFile: string,
): Promise<Decided | null> {
  for (;;) {
    const answer = await ctx.io.ask(GATE_PROMPT);
    if (answer === null) return null;
    const reply = parseGateReply(answer, view.gate);
    try {
      switch (reply.kind) {
        case 'quit':
          return null;
        case 'invalid':
          ctx.io.err(reply.message);
          continue;
        case 'edit': {
          await ctx.io.edit(editFile);
          const notes = reply.notes ? { notes: reply.notes } : {};
          const action = await withProposal(ctx, { action: 'edit', file: editFile, ...notes });
          return { proposal: applyDecision(ctx, view.runId, view.gate, action) };
        }
        case 'decide': {
          const decision = await withFields(ctx, reply.decision);
          if (!decision) return null;
          const action = await withProposal(ctx, decision);
          return { proposal: applyDecision(ctx, view.runId, view.gate, action) };
        }
      }
    } catch (error) {
      if (!isDecisionError(error)) throw error;
      ctx.io.err(decisionErrorText(error));
    }
  }
}

/**
 * A beat regenerate without fields: asks which part to change, suggesting what the feedback is
 * about (`feedbackAbout`), so a note about the board never sends the Scriptwriter a rewrite.
 * Null when the input ends.
 */
export async function withFields(ctx: CliContext, action: GateAction): Promise<GateAction | null> {
  if (action.action !== 'regenerate' || action.target !== 'beat' || action.fields) return action;
  const suggested = feedbackAbout(action.feedback ?? '');
  for (;;) {
    const answer = await ctx.io.ask(FIELDS_PROMPT(suggested));
    if (answer === null) return null;
    const fields = parseFieldsAnswer(answer, suggested);
    if (fields) return { ...action, fields };
    ctx.io.err('Type n (narration), b (board) or o (both), or press Enter for the suggestion.');
  }
}

/** A decision with text: asks whether the Analyst should propose a style rule from it (P1C.10). */
async function withProposal(ctx: CliContext, action: GateAction): Promise<GateAction> {
  const text = action.action === 'regenerate' ? action.feedback : action.notes;
  if (!text?.trim() || action.proposeRule) return action;
  const answer = await ctx.io.ask('Propose a style rule from this note? [y/N] ');
  return /^y(es)?$/i.test(answer?.trim() ?? '') ? { ...action, proposeRule: true } : action;
}

/**
 * One decision at the gate the run waits at, through the same service as the API. Returns the
 * style-rule proposal it queued (`proposeRule`), if any.
 */
export function applyDecision(
  ctx: CliContext,
  runId: number,
  gate: GateId,
  action: GateAction,
): PendingProposal | undefined {
  const view = readGate(ctx.db, ctx.config.dataDir, runId, gate);
  const result = decideAtGate(
    ctx.db,
    ctx.config.dataDir,
    runId,
    gate,
    decisionOf(ctx, view, action),
  );
  if (action.action === 'edit') {
    ctx.io.out(
      result.saved
        ? `Saved your edit as ${result.saved.kind === 'step' ? 'step' : 'version'} ${result.saved.id}.`
        : 'The edit is the same as what the gate reviews: nothing saved.',
    );
    for (const issue of result.issues)
      ctx.io.out(`  · ${issue.code} at ${issue.path}: ${issue.message}`);
  } else {
    if (action.action === 'regenerate' && action.target === 'beat' && action.fields) {
      ctx.io.out(regenerateRunsLine(action.beatId ?? '', action.fields));
    }
    ctx.io.out(
      `${action.action} at gate ${gate}: the run is ${result.run.status} at ${result.run.step}.`,
    );
  }
  if (result.proposalJobId === null) return undefined;
  ctx.io.out(`The Analyst will propose a style rule from your note (job ${result.proposalJobId}).`);
  return { jobId: result.proposalJobId, eventId: result.eventId };
}

function decisionOf(ctx: CliContext, view: GateView, action: GateAction): GateDecision {
  const subjectId = view.subject?.id;
  const propose = action.proposeRule ? { proposeRule: true } : {};
  switch (action.action) {
    case 'approve':
      if (subjectId === undefined)
        throw new CliError(`Gate ${view.gate} has nothing to approve yet.`);
      return {
        action: 'approve',
        subjectId,
        ...(action.notes ? { notes: action.notes } : {}),
        ...propose,
      };
    case 'reject':
      return { action: 'reject', ...(action.notes ? { notes: action.notes } : {}), ...propose };
    case 'edit':
      if (subjectId === undefined) throw new CliError(`Gate ${view.gate} has nothing to edit yet.`);
      return {
        action: 'edit',
        subjectId,
        content: readJson(ctx, action.file),
        ...(action.notes ? { notes: action.notes } : {}),
        ...propose,
      };
    case 'regenerate': {
      const { target, beatId, fields, sourceId, feedback } = action;
      return {
        action: 'regenerate',
        target,
        ...(beatId !== undefined ? { beatId } : {}),
        ...(fields ? { fields: [...fields] } : {}),
        ...(sourceId !== undefined ? { sourceId } : {}),
        ...(feedback !== undefined ? { feedback } : {}),
        ...propose,
      };
    }
  }
}

function readJson(ctx: CliContext, file: string): unknown {
  const path = file.startsWith('/') ? file : join(ctx.io.cwd, file);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError(`${path} is not readable JSON: ${(error as Error).message}`);
  }
}

/** What the gate reviews, as JSON to edit: `runs/<id>/cli/<gate>-<subject>.json`. */
function writeEditFile(ctx: CliContext, view: GateView): string {
  const content = view.content;
  const value =
    content?.gate === 'research'
      ? content.notes
      : content?.gate === 'beat_sheet'
        ? content.plan
        : content?.spec;
  const rel = join(runDir(view.runId), 'cli', `${view.gate}-${view.subject?.id ?? 'none'}.json`);
  writeDataJson(ctx.config.dataDir, rel, value ?? null);
  return resolveDataPath(ctx.config.dataDir, rel);
}

export function isDecisionError(error: unknown): error is Error {
  return (
    error instanceof ConflictError ||
    error instanceof InvalidEditError ||
    error instanceof InvalidProposalError ||
    error instanceof RegenerateNotAllowedError ||
    error instanceof CliError
  );
}

export function decisionErrorText(error: Error): string {
  if (!(error instanceof InvalidEditError)) return error.message;
  return [error.message, ...error.issues.map((i) => `  · ${i.path}: ${i.message}`)].join('\n');
}

function finish(ctx: CliContext, end: Exclude<FollowEnd, { kind: 'gate' }>): number {
  const run = getRunSummary(ctx.db, end.runId)!;
  if (end.kind === 'interrupted') {
    ctx.io.out(`Stopped following ${runLabel(run)} (${run.status} at ${run.pipelineStep}).`);
    ctx.io.out(`  Follow it again: pnpm studio resume ${run.id}`);
    return EXIT.interrupted;
  }
  if (end.kind === 'paused') {
    ctx.io.out(`${runLabel(run)} is paused at its cost cap (${run.pipelineStep}).`);
    ctx.io.out(`  Raise it: pnpm studio resume ${run.parentRunId ?? run.id} --cap <usd>`);
    return EXIT.failed;
  }
  ctx.io.out(`${runLabel(run)}: ${end.status}.`);
  for (const line of costTable(ctx, end.runId)) ctx.io.out(line);
  if (end.status === 'failed') {
    ctx.io.out(`  ${run.lastError ?? 'no error recorded'}`);
    ctx.io.out(`  Resume: pnpm studio resume ${run.id}`);
    return EXIT.failed;
  }
  for (const id of [end.runId, ...listPartRuns(ctx.db, end.runId).map((p) => p.id)]) {
    for (const row of listRunExports(ctx.db, id)) {
      ctx.io.out(`  Export: ${join(ctx.config.dataDir, row.mp4Path)}`);
      ctx.io.out(`          ${join(ctx.config.dataDir, row.srtPath)}`);
    }
  }
  return end.status === 'done' ? EXIT.ok : EXIT.failed;
}

/** The LLM cost per role over a run and its parts, and the total. */
export function costTable(ctx: CliContext, rootId: number): string[] {
  const ids = [rootId, ...listPartRuns(ctx.db, rootId).map((p) => p.id)];
  const roles = new Map<string, { calls: number; costUsd: number }>();
  for (const id of ids) {
    for (const row of runCostByRole(ctx.db, id)) {
      const sum = roles.get(row.role) ?? { calls: 0, costUsd: 0 };
      roles.set(row.role, { calls: sum.calls + row.calls, costUsd: sum.costUsd + row.costUsd });
    }
  }
  const lines = [...roles].map(
    ([role, r]) =>
      `  ${role.padEnd(13)} ${String(r.calls).padStart(4)} calls  $${r.costUsd.toFixed(4)}`,
  );
  return [
    'LLM cost:',
    ...lines,
    `  ${'total'.padEnd(13)} ${' '.repeat(10)} $${videoCostUsd(ctx.db, rootId).toFixed(4)}`,
  ];
}

/** "Regenerating b2 (board): runs the Generator, then a Curator review of the beat." */
export function regenerateRunsLine(beatId: string, fields: readonly FixField[]): string {
  const [first, ...rest] = regenerateAgents(fields);
  const then = rest.length > 0 ? `, then ${rest.join(', then ')}` : '';
  return `Regenerating ${beatId} (${fields.join(', ')}): runs ${first}${then}.`;
}
