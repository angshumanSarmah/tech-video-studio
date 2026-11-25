import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { z } from 'zod';

/**
 * Writing and reading the JSON sidecars next to render outputs; their schemas live in
 * `#core/render-manifests.ts` (the server reads them too).
 */
export {
  DraftManifestSchema,
  FinalManifestSchema,
  manifestPathFor,
  StillsManifestSchema,
  type DraftManifest,
  type FinalManifest,
  type StillsManifest,
} from '#core/render-manifests.ts';

/** Writes pretty JSON atomically (temp file + rename), so a reader never sees half a file. */
export function writeManifest(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readManifest<S extends z.ZodType>(schema: S, path: string): z.output<S> {
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
