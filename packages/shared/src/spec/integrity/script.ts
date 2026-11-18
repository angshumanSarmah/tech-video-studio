import { narrationWords } from '../narration.ts';
import { headlineAnchor } from '../script.ts';
import type { VideoSpec } from '../shape.ts';
import type { SpecIssue } from './issue.ts';
import { anchorProblem } from './scenes.ts';

/** Headline word anchors must land inside their own beat's narration. */
export function checkScript({ script }: VideoSpec): SpecIssue[] {
  return (script ?? []).flatMap((beat, i) => {
    if (!beat.headline) return [];
    const message = anchorProblem(headlineAnchor(beat.headline), narrationWords(beat.narration));
    return message
      ? [{ path: ['script', i, 'headline', 'at'], code: 'anchor_out_of_range', message }]
      : [];
  });
}
