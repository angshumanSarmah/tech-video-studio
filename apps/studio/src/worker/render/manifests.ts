import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SpecSourceSchema } from './target.ts';

/**
 * JSON sidecars next to render outputs, recording which spec version made them (and the frames
 * they hold). `source` is null for renders outside a run (the benchmark's fixture).
 */

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

/** Writes pretty JSON atomically (temp file + rename), so a reader never sees half a file. */
export function writeManifest(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readManifest<S extends z.ZodType>(schema: S, path: string): z.output<S> {
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
