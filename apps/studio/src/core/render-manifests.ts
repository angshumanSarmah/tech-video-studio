import { z } from 'zod';

/**
 * The JSON sidecars next to render outputs (written by the worker's render service), recording
 * which spec version made them. Here so the server can tell whether a run's stills or draft show
 * the version a gate reviews. `source` is null for renders outside a run (the benchmark).
 */

/** A `spec_versions` row: its id and its per-run version number. */
export const SpecSourceSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
});
export type SpecSource = z.infer<typeof SpecSourceSchema>;

const SourceSchema = SpecSourceSchema.nullable();

/** `runs/<id>/draft.json`: the joined draft, and the version each clip in it was made from. */
export const DraftManifestSchema = z.strictObject({
  source: SourceSchema,
  fps: z.number().int().positive(),
  frames: z.number().int().positive(),
  clips: z.array(z.strictObject({ beatId: z.string(), source: SourceSchema })),
});
export type DraftManifest = z.infer<typeof DraftManifestSchema>;

/** `exports/<id>/<slug>.json`: the final MP4's version. */
export const FinalManifestSchema = z.strictObject({
  source: SourceSchema,
  fps: z.number().int().positive(),
  frames: z.number().int().positive(),
});
export type FinalManifest = z.infer<typeof FinalManifestSchema>;

/** `runs/<id>/stills/stills.json`: the version the stills show, and each beat's key frame. */
export const StillsManifestSchema = z.strictObject({
  source: SourceSchema,
  fps: z.number().int().positive(),
  frames: z.record(z.string(), z.number().int().min(0)),
});
export type StillsManifest = z.infer<typeof StillsManifestSchema>;

/** The sidecar of an output file: the same path with `.json` for its extension. */
export function manifestPathFor(outputPath: string): string {
  const dot = outputPath.lastIndexOf('.');
  const base = dot > outputPath.lastIndexOf('/') ? outputPath.slice(0, dot) : outputPath;
  return `${base}.json`;
}
