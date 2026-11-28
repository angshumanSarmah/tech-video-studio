import { existsSync } from 'node:fs';
import {
  buildAssetRegistry,
  DEFAULT_REGISTRIES,
  withRegistryChecks,
} from '@explainer-studio/renderer/catalog';
import {
  validateRenderableVideoSpec,
  type MissingAsset,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { loadAssetLibrary, type AssetProblem } from '#core/assets/library.ts';
import { prepareRenderAssets } from '#core/assets/render-assets.ts';
import { readDataJson, resolveDataPath } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { getRunRenderContext, type RunRenderContext } from '#core/db/repositories/run-render.ts';
import { NotFoundError } from '#core/errors.ts';
import { pinnedSpecVersion } from '#core/services/spec-versions.ts';
import type { RenderTarget } from './target.ts';

/** One spec version of a run, resolved for rendering, with what a final render must refuse. */
export interface RunRenderInput {
  readonly context: RunRenderContext;
  /** The version rendered; `target.source` carries the same, for output sidecars. */
  readonly specVersion: number;
  readonly target: RenderTarget;
  /** Placeholders the render will draw (unknown ids, unfilled logo slots). */
  readonly missing: MissingAsset[];
  /** Asset files that failed to load. */
  readonly problems: AssetProblem[];
  /** `withRegistryChecks` over the spec: drafts draw errors as markers, finals refuse them. */
  readonly registry: { errors: SpecError[]; warnings: SpecError[] };
}

/**
 * Loads exactly the spec version a job was queued with (`specVersionId`, a `spec_versions` row
 * of this run; newer versions saved since are ignored) and resolves everything a render takes:
 * series and handle from the DB, assets and logos (`prepareRenderAssets`), and the narration
 * file. Throws when the version is unknown or belongs to another run, with every structured
 * error when the spec is not renderable, and when it has timing but its narration file is
 * missing (a timed spec never renders silently).
 */
export function loadRunRenderInput(
  db: Db,
  dataDir: string,
  runId: number,
  specVersionId: number,
): RunRenderInput {
  const context = getRunRenderContext(db, runId);
  if (!context) throw new NotFoundError('run', runId);
  const version = pinnedSpecVersion(db, runId, specVersionId);
  const raw = readDataJson(dataDir, version.jsonPath);
  const spec = parseSpec(raw, version.version);
  // Checked against the approved library (imports, uploads, approved drafts), not the seed set.
  const library = buildAssetRegistry(loadAssetLibrary(db, dataDir).assets);
  const registry = withRegistryChecks(validateRenderableVideoSpec(raw), raw, {
    ...DEFAULT_REGISTRIES,
    assets: library,
  });
  const assets = prepareRenderAssets(db, dataDir, runId, spec);
  const target: RenderTarget = {
    spec,
    props: { series: context.series, channelHandle: context.channelHandle, assets: assets.assets },
    audioPath: narrationPath(dataDir, spec),
    source: { specVersionId: version.id, version: version.version },
  };
  return {
    context,
    specVersion: version.version,
    target,
    missing: assets.missing,
    problems: assets.problems,
    registry: { errors: registry.errors, warnings: registry.warnings },
  };
}

function parseSpec(raw: unknown, version: number): RenderableVideoSpec {
  const result = validateRenderableVideoSpec(raw);
  if (result.ok) return result.spec;
  throw new Error(`Spec v${version} is not renderable:\n${formatIssues(result.errors)}`);
}

/** The narration WAV of a timed spec (`timing.audioFile`, relative to the data dir). */
function narrationPath(dataDir: string, spec: RenderableVideoSpec): string | null {
  if (!spec.timing) return null;
  const path = resolveDataPath(dataDir, spec.timing.audioFile);
  if (!existsSync(path)) {
    throw new Error(
      `Narration file ${spec.timing.audioFile} is missing; re-run TTS before rendering.`,
    );
  }
  return path;
}

/**
 * Why a final render must refuse this input (empty when it may go ahead): no narration yet,
 * registry errors (they would draw red markers), `unknown_asset` warnings, unfilled logo slots
 * and asset files that failed to load (placeholders are draft-only). Pure.
 */
export function finalRenderBlockers(input: RunRenderInput): string[] {
  const blockers: string[] = [];
  if (!input.target.spec.timing) blockers.push('The spec has no narration timing yet (run TTS).');
  blockers.push(...input.registry.errors.map(formatIssue));
  const unknownAssets = input.registry.warnings.filter((w) => w.code === 'unknown_asset');
  blockers.push(...unknownAssets.map(formatIssue));
  blockers.push(...input.missing.map((m) => `Missing ${m.kind} ${m.id} ("${m.label}").`));
  blockers.push(...input.problems.map((p) => `Asset ${p.id} failed to load: ${p.message}`));
  return [...new Set(blockers)];
}

export function formatIssues(issues: readonly SpecError[]): string {
  return issues.map((issue) => `  ${formatIssue(issue)}`).join('\n');
}

function formatIssue(issue: SpecError): string {
  return `${issue.path} [${issue.code}] ${issue.message}`;
}

/** File name for the export: the topic title as a slug (`run-<id>` when nothing is left). */
export function exportSlug(topicTitle: string, runId: number): string {
  const slug = topicTitle
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || `run-${runId}`;
}
