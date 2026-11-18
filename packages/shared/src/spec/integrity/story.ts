import type { VideoSpec } from '../shape.ts';
import { findDuplicateIds, unknownReference, type SpecIssue } from './issue.ts';

/** Allowed drift between the beats' target seconds and the video's target length. */
export const BEAT_SECONDS_TOLERANCE = 0.1;

type Story = VideoSpec['story'];

export function checkStory(spec: VideoSpec): SpecIssue[] {
  const { story } = spec;
  return [
    ...findDuplicateIds(
      story.chapters.map((c) => c.id),
      (i) => ['story', 'chapters', i, 'id'],
    ),
    ...findDuplicateIds(
      story.beats.map((b) => b.id),
      (i) => ['story', 'beats', i, 'id'],
    ),
    ...checkChapterRefs(story),
    ...checkBeatRefs(story),
    ...checkPlantedQuestion(story),
    ...checkBeatSeconds(spec),
  ];
}

/** Beats point at known chapters, chapters appear in order and none is empty. */
function checkChapterRefs(story: Story): SpecIssue[] {
  const chapterOrder = new Map(story.chapters.map((c, i) => [c.id, i]));
  const issues: SpecIssue[] = [];
  let lastChapter = 0;
  story.beats.forEach((beat, i) => {
    const order = chapterOrder.get(beat.chapterId);
    if (order === undefined) {
      issues.push(unknownReference(['story', 'beats', i, 'chapterId'], 'chapter', beat.chapterId));
      return;
    }
    if (order < lastChapter) {
      issues.push({
        path: ['story', 'beats', i, 'chapterId'],
        code: 'chapter_order',
        message: `Beat "${beat.id}" goes back to an earlier chapter; beats must follow chapter order.`,
      });
    }
    lastChapter = Math.max(lastChapter, order);
  });
  const used = new Set(story.beats.map((b) => b.chapterId));
  story.chapters.forEach((chapter, i) => {
    if (!used.has(chapter.id)) {
      issues.push({
        path: ['story', 'chapters', i],
        code: 'empty_chapter',
        message: `Chapter "${chapter.id}" has no beats.`,
      });
    }
  });
  return issues;
}

/** Story-level fields that point at beats. */
function checkBeatRefs(story: Story): SpecIssue[] {
  const beatIds = new Set(story.beats.map((b) => b.id));
  const refs: [SpecIssue['path'], string | undefined][] = [
    [['story', 'plantedQuestion', 'beatId'], story.plantedQuestion?.beatId],
    [['story', 'plantedQuestion', 'payoffBeatId'], story.plantedQuestion?.payoffBeatId],
    [['story', 'rejectedAlternative', 'beatId'], story.rejectedAlternative?.beatId],
  ];
  return refs.flatMap(([path, id]) =>
    id === undefined || beatIds.has(id) ? [] : [unknownReference(path, 'beat', id)],
  );
}

function checkPlantedQuestion(story: Story): SpecIssue[] {
  const question = story.plantedQuestion;
  if (!question) return [];
  const beatIndex = (id: string) => story.beats.findIndex((b) => b.id === id);
  const planted = beatIndex(question.beatId);
  const payoff = beatIndex(question.payoffBeatId);
  if (planted < 0 || payoff < 0 || payoff > planted) return [];
  return [
    {
      path: ['story', 'plantedQuestion', 'payoffBeatId'],
      code: 'payoff_not_after_question',
      message: `Payoff beat "${question.payoffBeatId}" must come after "${question.beatId}".`,
    },
  ];
}

function checkBeatSeconds(spec: VideoSpec): SpecIssue[] {
  const target = spec.meta.targetLengthSec;
  const total = spec.story.beats.reduce((sum, beat) => sum + beat.targetSec, 0);
  if (Math.abs(total - target) <= target * BEAT_SECONDS_TOLERANCE) return [];
  return [
    {
      path: ['story', 'beats'],
      code: 'beat_seconds_mismatch',
      message: `Beat targetSec values sum to ${total} s; expected ${target} s ±${BEAT_SECONDS_TOLERANCE * 100}%.`,
    },
  ];
}
