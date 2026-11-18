import type { z } from 'zod';
import { findSpecErrors } from './integrity/index.ts';
import { RenderableVideoSpecShapeSchema, VideoSpecShapeSchema, type VideoSpec } from './shape.ts';

/** Reports cross-reference issues as custom Zod issues; `params.code` carries the issue code. */
function addSpecIssues(spec: VideoSpec, ctx: z.RefinementCtx): void {
  for (const issue of findSpecErrors(spec)) {
    ctx.addIssue({
      code: 'custom',
      path: issue.path,
      message: issue.message,
      params: { code: issue.code },
    });
  }
}

/** A VideoSpec at any pipeline stage: structure plus cross-reference checks. */
export const VideoSpecSchema = VideoSpecShapeSchema.superRefine(addSpecIssues);

/** A VideoSpec ready to render. Validate with this before handing a spec to Remotion. */
export const RenderableVideoSpecSchema = RenderableVideoSpecShapeSchema.superRefine(addSpecIssues);
