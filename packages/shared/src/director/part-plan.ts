import type { DirectorPlan } from './plan.ts';

/**
 * One part of a multi-part plan as the plan of its own video (P1C.9): a child run's plan. Its
 * beats and the chapters they sit in, its target length, the planted question and rejected
 * alternative when both their beats are in it (the Director keeps each pair inside one part; a
 * pair split across parts is dropped rather than left pointing at another part), and the plan's
 * ending only on the last part; earlier parts end on a cliffhanger, without the spec card or CTA.
 * The series number is the parent's plus the part's offset (`part - 1`). Pure.
 */
export function partPlan(plan: DirectorPlan, part: number): DirectorPlan {
  const entry = plan.parts?.find((p) => p.part === part);
  if (!plan.parts || !entry) throw new Error(`The plan has no part ${part}.`);
  const ids = new Set(entry.beatIds);
  const beats = plan.story.beats.filter((b) => ids.has(b.id));
  const chapterIds = new Set(beats.map((b) => b.chapterId));
  const last = part === plan.parts.length;
  const within = (...beatIds: (string | undefined)[]) =>
    beatIds.every((id) => id === undefined || ids.has(id));
  const { plantedQuestion, rejectedAlternative, ending, ...story } = plan.story;
  const rest = { ...plan };
  delete rest.parts;
  return {
    ...rest,
    meta: { ...plan.meta, targetLengthSec: entry.targetLengthSec },
    story: {
      ...story,
      beats,
      // Each part lists only the devices on its own beats (every listed device is on a beat).
      devices: story.devices.filter((d) => beats.some((b) => b.device === d)),
      chapters: plan.story.chapters.filter((c) => chapterIds.has(c.id)),
      ...(plantedQuestion && within(plantedQuestion.beatId, plantedQuestion.payoffBeatId)
        ? { plantedQuestion }
        : {}),
      ...(rejectedAlternative &&
      within(rejectedAlternative.beatId, rejectedAlternative.chosenBeatId)
        ? { rejectedAlternative }
        : {}),
      ending: last ? ending : { kind: 'cliffhanger_ending' },
    },
  };
}
