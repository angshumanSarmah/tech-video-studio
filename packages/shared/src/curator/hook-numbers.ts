import type { ResearchNotes } from '../research/notes.ts';
import { numberIndex } from '../script/note-values.ts';
import { numberKey, numberMentions } from '../script/number-mentions.ts';
import type { VideoSpec } from '../spec/shape.ts';
import { toJsonPath, type SpecError } from '../spec/validate.ts';

/**
 * A later beat that says the hook's number again retells the hook instead of calling back to it
 * (P1C.8; the Scriptwriter's rule: "call back to it in a phrase instead of retelling it with its
 * numbers"). The hook is the beat with `hookNumberIds`; every later beat's narration is read for
 * those values (`numberMentions`, everyday "one" to "three" aside). A beat that cites another
 * research number with the same value says that number, not the hook's. One issue per beat, at
 * the first repeat. Pure.
 */
export function hookNumberRepeats(spec: VideoSpec, notes: ResearchNotes): SpecError[] {
  const index = numberIndex(notes);
  const beats = spec.story.beats;
  const hookAt = beats.findIndex((b) => (b.hookNumberIds ?? []).length > 0);
  const hook = beats[hookAt];
  if (!hook) return [];
  const hookIds = new Set(hook.hookNumberIds);
  const hookKeys = new Map(
    [...hookIds].flatMap((id) => [...(index.keysById.get(id) ?? [])].map((k) => [k, id] as const)),
  );
  return beats.slice(hookAt + 1).flatMap((beat) => {
    const scriptIndex = (spec.script ?? []).findIndex((s) => s.beatId === beat.id);
    const script = spec.script?.[scriptIndex];
    if (!script) return [];
    const cited = new Set([...beat.factIds, ...script.statCards.map((c) => c.sourceRef)]);
    const repeat = numberMentions(script.narration)
      .filter((m) => !m.everyday)
      .find((m) => {
        const key = numberKey(m.value);
        if (!hookKeys.has(key)) return false;
        const others = (index.idsByKey.get(key) ?? []).filter((id) => !hookIds.has(id));
        return !others.some((id) => cited.has(id));
      });
    if (!repeat) return [];
    const id = hookKeys.get(numberKey(repeat.value)) ?? '';
    const number = notes.numbers.find((n) => n.id === id);
    const what = number ? ` (${id}: ${number.value} ${number.unit})` : '';
    return [
      {
        path: toJsonPath(['script', scriptIndex, 'narration']),
        code: 'hook_number_repeated',
        message:
          `"${repeat.text}" says the hook's number again${what}. Call back to the hook in a ` +
          'short phrase (the moment, not its number) instead of retelling it.',
      },
    ];
  });
}
