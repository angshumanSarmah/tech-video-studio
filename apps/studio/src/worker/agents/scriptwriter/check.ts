import {
  getPrimitive,
  hudTextWarnings,
  specLayoutWarnings,
  subtitleWarnings,
  TEXT_TRUNCATED,
  withRegistryChecks,
  type HudContext,
} from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  isScriptAdvisory,
  scriptProblems,
  ScriptLayerSchema,
  ScriptwriterOutputSchema,
  assembleScriptedSpec,
  toJsonPath,
  validateVideoSpec,
  type PlanSpecContext,
  type ScriptCheckContext,
  type BeatScript,
  type ScriptToCheck,
  type SpecError,
  type VideoSpec,
  previewSpec,
} from '@explainer-studio/shared';
import { z } from 'zod';
import type { OutputIssue } from '#worker/llm/types.ts';

export interface ScriptwriterCheckDeps extends ScriptCheckContext {
  /** What turns the plan into a spec (id, series, run format, series number). */
  readonly spec: PlanSpecContext;
  /** The HUD's run context, for `text_truncated` on headlines. */
  readonly hud: HudContext;
}

/**
 * Everything the Scriptwriter's answer must pass beyond its schema, as one `callJson` check: the
 * script's own checks (`scriptProblems`), the plan plus script as a spec (`validateVideoSpec` with
 * the registry checks: beat coverage and order, one formula card), the text the video would draw
 * from it in the default theme (headlines in the HUD, subtitle words, source footnotes) and each
 * on-screen item against the props schema of the primitive that shows it (`tag`, `stat_card`,
 * `formula_card`, `command_bubble`). Only issues in the script count: the plan passed gate 2.
 * Spec warnings count, like for every agent. Paths point into the answer (`$.script[i]...`).
 */
export function scriptwriterCheck(deps: ScriptwriterCheckDeps): (value: unknown) => OutputIssue[] {
  return (value) => {
    const strict = ScriptwriterOutputSchema.safeParse(value);
    const output = strict.success ? strict.data : lenientScript(value);
    if (!output) return [];
    const spec = assembleScriptedSpec(deps.plan, output.script, deps.spec);
    const result = withRegistryChecks(validateVideoSpec(spec), spec);
    return [
      ...scriptProblems(output, deps),
      ...[...result.errors, ...result.warnings].filter(inScript),
      ...(result.ok ? renderedTextIssues(result.spec, deps.hud) : []),
      ...(strict.success ? output.script.flatMap(onScreenIssues) : []),
    ].map(toOutputIssue);
  };
}

/** Lenient: a script layer the spec accepts, even past the output schema's text limits. */
const AnyScriptSchema = z.object({ script: ScriptLayerSchema });

/**
 * The answer's script when only the output schema's stricter limits fail, so one repair covers
 * those and the checks. The primitive checks then wait: the schema already reports the limits.
 */
function lenientScript(value: unknown): ScriptToCheck | undefined {
  const lenient = AnyScriptSchema.safeParse(value);
  return lenient.success ? lenient.data : undefined;
}

const inScript = (issue: { path: string }) => issue.path.startsWith('$.script');

/** Advisory script codes (`SCRIPT_ADVISORY_CODES`) are soft: never the reason for a repair. */
function toOutputIssue(issue: { path: string; code: string; message: string }): OutputIssue {
  const soft = isScriptAdvisory(issue.code) ? { soft: true } : {};
  return { path: issue.path, code: issue.code, message: issue.message, ...soft };
}

/**
 * `text_truncated` and `subtitle_word_too_wide` for the script's text, measured as the video
 * draws it: headlines (`hudTextWarnings`), narration words (`subtitleWarnings`) and source
 * footnotes (`specLayoutWarnings`, on empty boards). A spec the renderer cannot lay out adds
 * nothing; spec validation has reported why.
 */
function renderedTextIssues(spec: VideoSpec, hud: HudContext): SpecError[] {
  const preview = previewSpec(spec);
  const theme = getTheme();
  try {
    return [
      ...hudTextWarnings(preview, theme, hud),
      ...subtitleWarnings(preview, theme),
      ...specLayoutWarnings(preview, theme).filter((w) => w.code === TEXT_TRUNCATED),
    ].filter(inScript);
  } catch {
    return [];
  }
}

/** Stands in for a stat card's footnote when the beat has no source (`source_missing` says so). */
const SOURCE_PLACEHOLDER = 'source';

type Path = (string | number)[];

/** Each on-screen item as the props of the primitive that will show it. */
function onScreenItems(beat: BeatScript): [Path, string, unknown][] {
  return [
    ...beat.tags.map((text, j): [Path, string, unknown] => [['tags', j], 'tag', { text }]),
    ...beat.statCards.map((card, j): [Path, string, unknown] => [
      ['statCards', j],
      'stat_card',
      { value: card.value, label: card.label, source: beat.source ?? SOURCE_PLACEHOLDER },
    ]),
    ...(beat.formulaCard
      ? [[['formulaCard'], 'formula_card', beat.formulaCard] as [Path, string, unknown]]
      : []),
    ...(beat.commandBubble
      ? [[['commandBubble'], 'command_bubble', beat.commandBubble] as [Path, string, unknown]]
      : []),
  ];
}

function onScreenIssues(beat: BeatScript, index: number): SpecError[] {
  return onScreenItems(beat).flatMap(([base, primitive, props]) => {
    const parsed = getPrimitive(primitive)?.propsSchema.safeParse(props);
    if (!parsed || parsed.success) return [];
    return parsed.error.issues.map((issue) => {
      // A stat card's footnote is the beat's source line.
      const path: Path =
        primitive === 'stat_card' && issue.path[0] === 'source'
          ? ['script', index, 'source']
          : ['script', index, ...base, ...(issue.path as Path)];
      return {
        path: toJsonPath(path),
        code: issue.code,
        message: `As a \`${primitive}\`: ${issue.message}`,
      };
    });
  });
}
