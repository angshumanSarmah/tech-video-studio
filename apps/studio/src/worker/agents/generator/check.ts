import {
  beatCheckWarnings,
  boardAssetSwaps,
  DEFAULT_REGISTRIES,
  layerWarnings,
  screenTextWarnings,
  specLayoutWarnings,
  withAssetSwaps,
  withRegistryChecks,
  type AssetSwap,
  type Registries,
} from '@explainer-studio/renderer/catalog';
import { getTheme, type Theme } from '@explainer-studio/renderer/theme';
import {
  GeneratorOutputSchema,
  generatorScene,
  validateRenderableVideoSpec,
  type BeatScene,
  type GeneratorOutput,
  type ResearchNotes,
  type SpecError,
  type StoryBeat,
} from '@explainer-studio/shared';
import type { OutputIssue } from '#worker/llm/types.ts';
import { boardStart, placeholderScene, spliceBoards, type GeneratorBoards } from './board.ts';

/**
 * The Generator's checks for one beat (P1C.7): its board spliced into the run's timed spec, then
 * everything code can check about it, so the repair loop gets one list. Registry checks
 * (`withRegistryChecks`: ids, props, actions, parts, element refs, assets, timeline), layout
 * warnings in the run's format (`specLayoutWarnings`), the per-beat scene checks
 * (`beatCheckWarnings`) and the on-screen text checks (`screenTextWarnings`: script items placed
 * as written, research numbers only, no early terms, "e.g." on example labels). Only this beat's issues count, plus issues this beat causes in the
 * earlier beats of its board (compared with the same spec without it). Near-identical asset ids
 * are swapped first (`generatorAssetSwaps`, logged by the step); other unknown asset ids are soft:
 * drawn as placeholders and recorded, never a reason to repair.
 */

export interface GeneratorCheckDeps extends GeneratorBoards {
  /** The story beat this board is for. */
  readonly beatIndex: number;
  /** The research notes the plan was made from: the numbers a board may show. */
  readonly notes?: ResearchNotes;
  readonly registries?: Registries;
  readonly theme?: Theme;
  /**
   * Also the checks across boards (`layerWarnings`: a pattern repeated on the focus, static
   * beats), for the post-pass, where every board exists.
   */
  readonly crossBoard?: boolean;
}

export function generatorCheck(deps: GeneratorCheckDeps): (value: unknown) => OutputIssue[] {
  return (value) => {
    const parsed = GeneratorOutputSchema.safeParse(value);
    if (!parsed.success) return [];
    const board = withAssetSwaps(parsed.data, generatorAssetSwaps(parsed.data, deps));
    return beatIssues(deps, generatorScene(board, storyBeat(deps)));
  };
}

/**
 * The same checks on a board that already exists (the pinned spec's, or one drawn earlier in the
 * job), taken as it is: a regenerate re-checks the later beats of a board, the post-pass every
 * board with all the others in place.
 */
export function generatorSceneCheck(deps: GeneratorCheckDeps, scene: BeatScene): OutputIssue[] {
  return beatIssues(deps, scene);
}

/** The near-identical asset ids the step swaps in an answer (before checks; logged). */
export function generatorAssetSwaps(
  output: GeneratorOutput,
  deps: GeneratorCheckDeps,
): AssetSwap[] {
  const slots = new Set((deps.spec.logos ?? []).map((l) => l.id));
  return boardAssetSwaps(output, deps.registries ?? DEFAULT_REGISTRIES, slots);
}

function storyBeat(deps: GeneratorCheckDeps): StoryBeat {
  const beat = deps.spec.story.beats[deps.beatIndex];
  if (!beat) throw new Error(`No story beat at index ${deps.beatIndex}.`);
  return beat;
}

function beatIssues(deps: GeneratorCheckDeps, scene: BeatScene): OutputIssue[] {
  const i = deps.beatIndex;
  const own = scenePrefix(i);
  const earlier = boardStart(deps.spec, i);
  const baseline = new Set(specIssues(deps, placeholderScene(storyBeat(deps))).map(issueKey));
  return specIssues(deps, scene)
    .filter((issue) => {
      if (inScene(issue.path, own)) return true;
      const k = sceneIndexOf(issue.path);
      return k !== undefined && k >= earlier && k < i && !baseline.has(issueKey(issue));
    })
    .map((issue) => toOutputIssue(issue, own));
}

/** Every issue of the run's spec with `scene` at this beat and placeholders where none exist. */
function specIssues(deps: GeneratorCheckDeps, scene: BeatScene): SpecError[] {
  const registries = deps.registries ?? DEFAULT_REGISTRIES;
  const theme = deps.theme ?? getTheme();
  const spec = spliceBoards(deps, deps.beatIndex, scene);
  const result = withRegistryChecks(validateRenderableVideoSpec(spec), spec, registries);
  const issues = [...result.errors, ...result.warnings];
  if (!result.ok) return issues;
  return [
    ...issues,
    ...specLayoutWarnings(result.spec, theme, registries),
    ...beatCheckWarnings(result.spec, { registries, theme }),
    ...screenTextWarnings(result.spec, {
      registries,
      ...(deps.notes ? { notes: deps.notes } : {}),
    }),
    ...(deps.crossBoard ? layerWarnings(result.spec) : []),
  ];
}

const scenePrefix = (i: number) => `$.scenes[${i}]`;

function inScene(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

function sceneIndexOf(path: string): number | undefined {
  const match = /^\$\.scenes\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : undefined;
}

/** The advice layout warnings give, which a continuing beat cannot follow. */
const FEWER_ELEMENTS = 'Use fewer or smaller elements.';
const SPLIT_BEAT = 'Split the beat or group elements.';

/** What a continuing beat can do about room: only what it adds changes. */
const ONLY_ADDITIONS =
  'Everything already ON SCREEN keeps its place and size, and exiting an element frees no ' +
  'room, so change only what this beat adds. Never drop or reword a script item.';

/**
 * An issue this answer causes in an earlier beat of its board. One about room (a board too
 * small to read, or over its element limit) says what this beat can change: only what it adds,
 * since everything already on screen keeps its place and size (one layout per board).
 */
function earlierBeatMessage(issue: SpecError): string {
  const prefix = 'Caused in an earlier beat of this board by this answer: ';
  if (issue.code === 'text_too_small') {
    const measured = issue.message.replace(FEWER_ELEMENTS, '').replace(/\s+\(/, ' (').trim();
    return (
      `Your additions shrink this board below readable: ${measured} Add the script items and ` +
      'only what the narration shows happening, pin each script tag to the top or bottom of an ' +
      'element already on screen instead of placing it on its own, and keep text you write ' +
      `short. ${ONLY_ADDITIONS}`
    );
  }
  if (issue.code === 'too_many_elements') {
    const measured = issue.message.replace(SPLIT_BEAT, '').replace(/\s+\(/, ' (').trim();
    return (
      `Your additions put this board over its element limit: ${measured} Pinned elements do ` +
      'not count as elements here: pin each new script tag to an element already ON SCREEN ' +
      `that hosts pins, instead of placing it on its own or in a zone. ${ONLY_ADDITIONS}`
    );
  }
  return `${prefix}${issue.message}`;
}

const issueKey = (issue: SpecError) => `${issue.path} ${issue.code}`;

/**
 * Paths into this beat's board become paths into the answer (`$.scenes[3].events[0]` →
 * `$.events[0]`); an issue in an earlier beat of the board keeps its path and says so.
 * `unknown_asset` is soft.
 */
function toOutputIssue(issue: SpecError, own: string): OutputIssue {
  const mine = inScene(issue.path, own);
  return {
    path: mine ? `$${issue.path.slice(own.length)}` : issue.path,
    code: issue.code,
    message: mine ? issue.message : earlierBeatMessage(issue),
    ...(issue.code === 'unknown_asset' ? { soft: true } : {}),
  };
}
