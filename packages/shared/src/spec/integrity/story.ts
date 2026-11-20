import { DEVICE_IDS, ENDING_DEVICES } from '../../catalogues/devices.ts';
import { LAYOUT_MODE_IDS } from '../../catalogues/layout-modes.ts';
import { METAPHOR_WORLD_IDS } from '../../catalogues/metaphor-worlds.ts';
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
    ...checkChosenDesign(story),
    ...checkCatalogueIds(story),
    ...checkClockKeyframes(story),
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
    [['story', 'rejectedAlternative', 'chosenBeatId'], story.rejectedAlternative?.chosenBeatId],
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

/** The chosen design comes after the rejected alternative it replaces. */
function checkChosenDesign(story: Story): SpecIssue[] {
  const alternative = story.rejectedAlternative;
  if (alternative?.chosenBeatId === undefined) return [];
  const beatIndex = (id: string) => story.beats.findIndex((b) => b.id === id);
  const rejected = beatIndex(alternative.beatId);
  const chosen = beatIndex(alternative.chosenBeatId);
  if (rejected < 0 || chosen < 0 || chosen > rejected) return [];
  return [
    {
      path: ['story', 'rejectedAlternative', 'chosenBeatId'],
      code: 'chosen_not_after_alternative',
      message: `Chosen design beat "${alternative.chosenBeatId}" must come after the rejected alternative "${alternative.beatId}".`,
    },
  ];
}

/** Devices, ending devices, metaphor worlds and beat layout modes are catalogue ids. */
function checkCatalogueIds(story: Story): SpecIssue[] {
  const check = (
    path: SpecIssue['path'],
    what: string,
    id: string | undefined,
    known: readonly string[],
  ) => (id === undefined || known.includes(id) ? [] : [unknownReference(path, what, id, known)]);
  return [
    ...story.devices.flatMap((id, i) => check(['story', 'devices', i], 'device', id, DEVICE_IDS)),
    ...story.beats.flatMap((beat, i) => [
      ...check(['story', 'beats', i, 'device'], 'device', beat.device, DEVICE_IDS),
      ...check(
        ['story', 'beats', i, 'layoutMode'],
        'layout mode',
        beat.layoutMode,
        LAYOUT_MODE_IDS,
      ),
    ]),
    ...check(['story', 'metaphorWorld'], 'metaphor world', story.metaphorWorld, METAPHOR_WORLD_IDS),
    ...check(['story', 'ending', 'kind'], 'ending device', story.ending.kind, ENDING_DEVICES),
  ];
}

/** Keyframes name known beats, in story order, after the first beat (which is `startValue`). */
function checkClockKeyframes(story: Story): SpecIssue[] {
  const keyframes = story.heroMetric?.storyClock?.keyframes ?? [];
  const path = (k: number) => ['story', 'heroMetric', 'storyClock', 'keyframes', k, 'beatId'];
  const beatIndex = new Map(story.beats.map((b, i) => [b.id, i]));
  const issues = findDuplicateIds(
    keyframes.map((k) => k.beatId),
    path,
  );
  let last = 0;
  keyframes.forEach((keyframe, k) => {
    const index = beatIndex.get(keyframe.beatId);
    if (index === undefined) {
      issues.push(unknownReference(path(k), 'beat', keyframe.beatId));
      return;
    }
    const message =
      index === 0
        ? `Beat "${keyframe.beatId}" is the first beat; its clock value is startValue.`
        : index <= last
          ? `Keyframe for beat "${keyframe.beatId}" is out of story order.`
          : undefined;
    if (message) issues.push({ path: path(k), code: 'clock_keyframe_order', message });
    last = Math.max(last, index);
  });
  return issues;
}
