import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { beatRenderInputs, specAssetUses } from '@explainer-studio/renderer/catalog';
import type { RenderPreset } from '@explainer-studio/shared';
import { z } from 'zod';
import { encodingFor } from './encoding.ts';
import type { RenderTarget } from './target.ts';

/** Bump when the key's meaning changes (e.g. a new input), so every cached clip re-renders. */
export const DRAFT_KEY_VERSION = 1;

/** Sidecar next to each beat clip: what it was rendered from, and how many frames it has. */
export const DraftClipMetaSchema = z.strictObject({
  key: z.string().regex(/^[0-9a-f]{64}$/),
  frames: z.number().int().positive(),
  fps: z.number().int().positive(),
});
export type DraftClipMeta = z.infer<typeof DraftClipMetaSchema>;

export interface DraftKeyInput {
  readonly target: RenderTarget;
  readonly beatId: string;
  readonly preset: RenderPreset;
  /** `RenderEngine.identity()`: the renderer source the bundle was built from. */
  readonly engineIdentity: string;
  /** `audioSliceHash` of the narration under this clip, or null when silent. */
  readonly audioHash: string | null;
}

/**
 * sha256 of everything one beat clip is drawn from (pure): the beat's render inputs
 * (`beatRenderInputs`: its chain, the HUD's cross-beat data, global fields), the props other
 * than the spec with only the assets its chain uses, the preset and encoding, the renderer
 * source, and the narration slice under it.
 */
export function draftClipKey({ target, beatId, preset, engineIdentity, audioHash }: DraftKeyInput) {
  const inputs = beatRenderInputs(target.spec, beatId);
  const used = new Set(
    specAssetUses(target.spec)
      .filter((use) => inputs.chain.includes(use.beatId))
      .map((use) => use.id),
  );
  const { assets, ...props } = target.props;
  return sha256(
    canonicalJson({
      v: DRAFT_KEY_VERSION,
      engineIdentity,
      preset,
      encoding: encodingFor('draft'),
      props: { ...props, assets: assets?.filter((a) => used.has(a.id)) ?? null },
      inputs,
      audioHash,
    }),
  );
}

/** The clip's sidecar, if it and the clip exist and the sidecar parses. */
export function readClipMeta(clipPath: string, metaPath: string): DraftClipMeta | undefined {
  if (!existsSync(clipPath) || !existsSync(metaPath)) return undefined;
  try {
    return DraftClipMetaSchema.parse(JSON.parse(readFileSync(metaPath, 'utf8')));
  } catch {
    return undefined;
  }
}

/** JSON with object keys sorted at every level, so key order in the input never changes a key. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
