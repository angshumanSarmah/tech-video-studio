import { createHash } from 'node:crypto';
import { withAssetSwaps, type Registries } from '@explainer-studio/renderer/catalog';
import {
  GeneratorBeatInputSchema,
  GeneratorBeatOutputSchema,
  GeneratorOutputSchema,
  generatorScene,
  toJsonPath,
  type BeatScene,
  type BeatStepReason,
  type GeneratorBeatInput,
  type GeneratorBeatOutput,
  type LogLevel,
  type ResearchNotes,
  type VideoSpec,
} from '@explainer-studio/shared';
import {
  beatSceneInputPath,
  beatSceneOutputPath,
  readDataJson,
  writeDataJson,
} from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import {
  doneBeatSteps,
  failRunStep,
  finishRunStep,
  setRunStepInput,
  startRunStep,
} from '#core/db/repositories/run-steps.ts';
import type { LlmClient } from '#worker/llm/client.ts';
import type { BuiltPrompt } from '#worker/llm/types.ts';
import { buildPrompt } from '../prompt-builder.ts';
import type { PromptVariables } from '../prompt-variables.ts';
import type { PromptTemplates } from '../prompts/templates.ts';
import { settleAssetRequests } from './asset-requests.ts';
import { generatorAssetSwaps, generatorCheck } from './check.ts';
import { generatorUserMessage } from './input.ts';

/**
 * One Generator beat attempt (P1C.7): build the beat's prompt, reuse a finished step with the
 * same input hash, else call the model (after the job's warm-up call) with `generatorCheck`,
 * swap near-identical asset ids, and write the beat's input and board files on its own
 * `run_steps` row (stage `generate`, `beat_id`).
 */

export interface BeatStepContext {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  readonly variables: PromptVariables;
  /** `generatorCatalogueBlock(registries)`, built once per job. */
  readonly catalogue: string;
  readonly styleRules?: string;
  /** The Generator's model (`settings.llm.models.generator`), part of the input hash. */
  readonly model: string;
  readonly runId: number;
  readonly notes: ResearchNotes;
  readonly registries: Registries;
  readonly warmUp: <T>(call: () => Promise<T>) => Promise<T>;
  readonly signal: AbortSignal;
  readonly log: (level: LogLevel, message: string) => void;
}

export interface BeatRequest {
  readonly spec: VideoSpec;
  /** The boards this beat may see (`visibleScenes`): they shape its prompt. */
  readonly scenes: readonly (BeatScene | undefined)[];
  /** The boards its answer is checked against; default `scenes` (the post-pass passes all). */
  readonly checkScenes?: readonly (BeatScene | undefined)[];
  readonly beatIndex: number;
  readonly reason: BeatStepReason;
  readonly feedback?: string;
  /** Mixed into the hash so a regenerate calls the model again (the job id). */
  readonly salt?: string;
  /** Check across boards too (the post-pass retry). */
  readonly crossBoard?: boolean;
}

export interface BeatResult {
  readonly stepId: number;
  readonly scene: BeatScene;
  readonly output: GeneratorBeatOutput;
  /** A finished step with the same input was reused: no call was made. */
  readonly reused: boolean;
}

export async function drawBeat(c: BeatStepContext, req: BeatRequest): Promise<BeatResult> {
  const beat = req.spec.story.beats[req.beatIndex];
  if (!beat) throw new Error(`No story beat at index ${req.beatIndex}.`);
  const prompt = beatPrompt(c, req);
  const input: GeneratorBeatInput = {
    beatId: beat.id,
    beatIndex: req.beatIndex,
    reason: req.reason,
    inputHash: inputHash(c.model, prompt, req),
    model: c.model,
    promptVersion: prompt.versions.role,
    feedback: req.feedback ?? null,
  };
  const reused = reusableStep(c, input);
  if (reused) return { ...reused, reused: true };
  return callBeat(c, req, prompt, input);
}

function beatPrompt(c: BeatStepContext, req: BeatRequest): BuiltPrompt {
  const message = generatorUserMessage({
    spec: req.spec,
    scenes: req.scenes,
    beatIndex: req.beatIndex,
    notes: c.notes,
    registries: c.registries,
    ...(req.feedback ? { feedback: req.feedback } : {}),
  });
  return buildPrompt(c.prompts, {
    role: 'generator',
    variables: c.variables,
    catalogue: c.catalogue,
    ...(c.styleRules ? { styleRules: c.styleRules } : {}),
    input: message,
  });
}

/** What decides the answer: model, prompt versions and messages, the check, a regenerate's salt. */
export function inputHash(model: string, prompt: BuiltPrompt, req: BeatRequest): string {
  const key = {
    model,
    versions: prompt.versions,
    messages: prompt.messages,
    check: req.crossBoard ? 'cross-board' : 'beat',
    salt: req.salt ?? null,
  };
  return createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

/** The newest finished step of this beat with the same input hash, if any. */
function reusableStep(
  c: BeatStepContext,
  input: GeneratorBeatInput,
): Omit<BeatResult, 'reused'> | undefined {
  for (const step of doneBeatSteps(c.db, c.runId, 'generate', input.beatId)) {
    if (!step.inputPath || !step.outputPath) continue;
    const before = GeneratorBeatInputSchema.safeParse(readDataJson(c.dataDir, step.inputPath));
    if (!before.success || before.data.inputHash !== input.inputHash) continue;
    const output = GeneratorBeatOutputSchema.safeParse(readDataJson(c.dataDir, step.outputPath));
    if (output.success) return { stepId: step.id, scene: output.data.scene, output: output.data };
  }
  return undefined;
}

async function callBeat(
  c: BeatStepContext,
  req: BeatRequest,
  prompt: BuiltPrompt,
  input: GeneratorBeatInput,
): Promise<BeatResult> {
  const step = startRunStep(c.db, { runId: c.runId, stage: 'generate', beatId: input.beatId });
  try {
    const inputPath = beatSceneInputPath(c.runId, input.beatId, step.id);
    setRunStepInput(c.db, step.id, writeDataJson(c.dataDir, inputPath, input));
    const boards = {
      spec: req.spec,
      scenes: req.checkScenes ?? req.scenes,
      beatIndex: req.beatIndex,
      notes: c.notes,
      registries: c.registries,
      ...(req.crossBoard ? { crossBoard: true } : {}),
    };
    const result = await c.warmUp(() =>
      c.llm.callJson({
        role: 'generator',
        prompt,
        schema: GeneratorOutputSchema,
        runId: c.runId,
        stepId: step.id,
        check: generatorCheck(boards),
        replayKey: input.beatId,
        signal: c.signal,
        log: (level, message) => c.log(level, `Beat ${input.beatId}: ${message}`),
      }),
    );
    const swaps = generatorAssetSwaps(result.value, boards);
    const settled = settleAssetRequests(withAssetSwaps(result.value, swaps), c.registries);
    const board = settled.board;
    for (const note of settled.notes) c.log('warn', `Beat ${input.beatId}: ${note}`);
    const beat = req.spec.story.beats[req.beatIndex];
    if (!beat) throw new Error(`No story beat at index ${req.beatIndex}.`);
    const output: GeneratorBeatOutput = {
      scene: generatorScene(board, beat),
      swaps: swaps.map((s) => ({ path: toJsonPath(s.path), from: s.from, to: s.to })),
      missingPrimitiveRequests: board.missingPrimitiveRequests ?? [],
    };
    for (const s of output.swaps) {
      c.log('info', `Beat ${input.beatId}: asset "${s.from}" read as "${s.to}" (${s.path}).`);
    }
    const outputPath = beatSceneOutputPath(c.runId, input.beatId, step.id);
    finishRunStep(c.db, step.id, writeDataJson(c.dataDir, outputPath, output));
    return { stepId: step.id, scene: output.scene, output, reused: false };
  } catch (error) {
    failRunStep(c.db, step.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
