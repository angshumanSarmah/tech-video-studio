import { z } from 'zod';
import { finalCheckPath, readDataJson, writeDataJson } from '../data-files.ts';
import { existsSync } from 'node:fs';
import { resolveDataPath } from '../data-files.ts';

/**
 * What would stop the final render (P1C.9): the render_draft job checks the version it rendered
 * (`finalRenderBlockers`, worker-only) and records it here, so the draft gate can tell whether it
 * may be auto-approved without loading the renderer.
 */
export const FinalCheckSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  blockers: z.array(z.string()),
});
export type FinalCheck = z.infer<typeof FinalCheckSchema>;

export function writeFinalCheck(dataDir: string, runId: number, check: FinalCheck): void {
  writeDataJson(dataDir, finalCheckPath(runId), FinalCheckSchema.parse(check));
}

/** The final's blockers for `specVersionId`; one blocker when the draft of it was not checked. */
export function finalBlockers(dataDir: string, runId: number, specVersionId: number): string[] {
  const path = finalCheckPath(runId);
  if (!existsSync(resolveDataPath(dataDir, path))) {
    return ['The draft has not been checked for the final render.'];
  }
  const check = FinalCheckSchema.parse(readDataJson(dataDir, path));
  if (check.specVersionId !== specVersionId) {
    return [
      `The draft was checked for spec version id ${check.specVersionId}, not ${specVersionId}.`,
    ];
  }
  return check.blockers;
}
