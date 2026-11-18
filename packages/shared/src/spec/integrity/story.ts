import type { VideoSpec } from '../shape.ts';
import { findDuplicateIds, unknownReference, type SpecIssue } from './issue.ts';

type Story = VideoSpec['story'];

export function checkStory({ story }: VideoSpec): SpecIssue[] {
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
