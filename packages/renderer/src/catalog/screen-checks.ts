import {
  mentionsTerm,
  numberIndex,
  numberKey,
  numberMentions,
  researchValueKeys,
  toJsonPath,
  type BeatScene,
  type BeatScript,
  type RenderableVideoSpec,
  type ResearchNotes,
  type SceneElement,
  type SpecError,
  type StoryBeat,
} from '@explainer-studio/shared';
import { sceneChain } from '../scene/beat-world.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { paramLeaves, propLeaves, type Leaf } from './schema-leaves.ts';

/**
 * On-screen text checks for agent boards (P1C.7; the Curator reuses them). Tags, stat cards, the
 * formula card and the command bubble belong to the script: each is placed exactly once, as
 * written (`script_text_missing`, `script_text_changed`). Everything else the board shows is
 * written by the Generator and checked here: every number is a research value of this beat or of
 * an earlier beat on the same board (`screen_number_not_in_notes`; seconds compared with research
 * times converted by code), no label names a term a later beat introduces
 * (`label_term_too_early`), and in an `exampleNumbers` beat a label with a number starts with
 * "e.g." (`example_label_unmarked`). Pure.
 */

type Path = (string | number)[];

export type ScreenCheckOptions = {
  /** The run's research notes; without them the number check is skipped (fixtures). */
  notes?: ResearchNotes;
  registries?: Registries;
};

/** Primitives that show the script's on-screen text, and the prop each shows it in. */
export const SCRIPT_PRIMITIVES = {
  tag: 'text',
  stat_card: 'value',
  formula_card: 'latex',
  command_bubble: 'text',
} as const;

type ScriptPrimitive = keyof typeof SCRIPT_PRIMITIVES;

/** The prefix that marks an example number in a label. */
export const EXAMPLE_LABEL_PREFIX = 'e.g.';

/** Everyday counts a board may show without a research number (a tally of 3, a count from 0). */
const EVERYDAY_VALUES: ReadonlySet<string> = new Set(['0', '1', '2', '3']);

/** Seconds per time unit a research number may be written in (lower case, singular or plural). */
const SECONDS_PER_UNIT: Readonly<Record<string, number>> = {
  ms: 0.001,
  millisecond: 0.001,
  milliseconds: 0.001,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  day: 86_400,
  days: 86_400,
};

export function screenTextWarnings(
  spec: RenderableVideoSpec,
  { notes, registries = DEFAULT_REGISTRIES }: ScreenCheckOptions = {},
): SpecError[] {
  return spec.scenes.flatMap((scene, i) => {
    const written = generatorLeaves(scene, i, registries);
    return [
      ...scriptTextChecks(spec.script[i], scene, i),
      ...(notes ? numberChecks(spec, notes, i, written) : []),
      ...termChecks(spec, i, written),
      ...exampleChecks(spec.story.beats[i], written),
    ];
  });
}

function warning(path: Path, code: string, message: string): SpecError {
  return { path: toJsonPath(path), code, message };
}

// --- Script-owned text -------------------------------------------------------------------------

type Expected = {
  primitive: ScriptPrimitive;
  describe: string;
  matches: (props: Props) => boolean;
};
type Props = Record<string, unknown>;

const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim();

/** A tag's text is drawn in upper case: case does not matter. */
const sameTag = (a: unknown, b: string) =>
  typeof a === 'string' &&
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

function expectedItems(script: BeatScript | undefined): Expected[] {
  if (!script) return [];
  const { tags, statCards, formulaCard, commandBubble } = script;
  return [
    ...tags.map((text): Expected => ({
      primitive: 'tag',
      describe: `tag "${text}"`,
      matches: (p) => sameTag(p.text, text),
    })),
    ...statCards.map((card): Expected => ({
      primitive: 'stat_card',
      describe: `stat card "${card.value}" / "${card.label}"`,
      matches: (p) => same(p.value, card.value) && same(p.label, card.label),
    })),
    ...(formulaCard
      ? [
          {
            primitive: 'formula_card' as const,
            describe: `formula card "${formulaCard.latex}"`,
            matches: (p: Props) =>
              same(p.latex, formulaCard.latex) &&
              (formulaCard.caption === undefined || same(p.caption, formulaCard.caption)),
          },
        ]
      : []),
    ...(commandBubble
      ? [
          {
            primitive: 'command_bubble' as const,
            describe: `command bubble "${commandBubble.text}"`,
            matches: (p: Props) => same(p.text, commandBubble.text),
          },
        ]
      : []),
  ];
}

const isScriptPrimitive = (id: string): id is ScriptPrimitive => id in SCRIPT_PRIMITIVES;

/** Each script item on the board once, as written; no others of those primitives. */
function scriptTextChecks(
  script: BeatScript | undefined,
  scene: BeatScene,
  i: number,
): SpecError[] {
  const expected = expectedItems(script);
  const used = new Set<Expected>();
  const changed = scene.elements.flatMap((element, j) => {
    if (!isScriptPrimitive(element.primitive)) return [];
    const props = (element.props ?? {}) as Props;
    const match = expected.find(
      (e) => !used.has(e) && e.primitive === element.primitive && e.matches(props),
    );
    if (match) {
      used.add(match);
      return [];
    }
    const field = SCRIPT_PRIMITIVES[element.primitive];
    const options = expected
      .filter((e) => e.primitive === element.primitive)
      .map((e) => e.describe);
    const allowed =
      options.length > 0 ? `Use one of: ${options.join(', ')}.` : 'This beat has none.';
    return [
      warning(
        ['scenes', i, 'elements', j, 'props', field],
        'script_text_changed',
        `This ${element.primitive} is not one of this beat's script items, written exactly. ` +
          `${allowed} Add none of your own.`,
      ),
    ];
  });
  const missing = expected
    .filter((e) => !used.has(e))
    .map((e) =>
      warning(
        ['scenes', i, 'elements'],
        'script_text_missing',
        `The script's ${e.describe} is not on the board: place it as a ${e.primitive} element, ` +
          'exactly as written, pinned to what it describes.',
      ),
    );
  return [...changed, ...missing];
}

// --- Text the Generator writes -----------------------------------------------------------------

type WrittenLeaf = Leaf & { path: Path };

/**
 * Text and numbers on this beat's board that the Generator writes: every prop and param leaf
 * except those of the script's own primitives (checked against the script instead).
 */
function generatorLeaves(scene: BeatScene, i: number, registries: Registries): WrittenLeaf[] {
  const elements = scene.elements.flatMap((element: SceneElement, j) => {
    const definition = registries.primitives.get(element.primitive);
    if (!definition || isScriptPrimitive(element.primitive)) return [];
    return propLeaves(definition, element.props ?? {}).map((leaf) => ({
      ...leaf,
      path: ['scenes', i, 'elements', j, 'props', ...leaf.path],
    }));
  });
  const patterns = scene.patterns.flatMap((pattern, j) => {
    const definition = registries.patterns.get(pattern.pattern);
    if (!definition) return [];
    return paramLeaves(definition, pattern.params ?? {}).map((leaf) => ({
      ...leaf,
      path: ['scenes', i, 'patterns', j, 'params', ...leaf.path],
    }));
  });
  return [...elements, ...patterns];
}

/**
 * Numbers that count: not an identifier, and not an everyday small count (a lone "one", "two" or
 * "three", or the digits 0 to 3, as in "API 1" or "1 number").
 */
const countedKeys = (text: string) =>
  numberMentions(text)
    .filter((m) => !m.everyday)
    .map((m) => numberKey(m.value))
    .filter((key) => !EVERYDAY_VALUES.has(key));

type Allowed = { plain: ReadonlySet<string>; seconds: ReadonlySet<string>; shown: string[] };

/**
 * The research values this beat may show: the numbers its board's beats so far cite (`factIds`,
 * hook numbers, stat cards) or say (narration, source line, script text), as written and, for
 * times, in seconds.
 */
function allowedValues(spec: RenderableVideoSpec, notes: ResearchNotes, i: number): Allowed {
  const scene = spec.scenes[i];
  const beats = scene ? sceneChain(spec.scenes, scene.beatId).map((s) => s.beatId) : [];
  const index = numberIndex(notes);
  const research = researchValueKeys(notes);
  const cited = beats.flatMap((id) => citedIds(spec, id));
  const said = beats.flatMap((id) => saidKeys(spec, id)).filter((k) => research.has(k));
  const ids = new Set([...cited, ...said.flatMap((k) => index.idsByKey.get(k) ?? [])]);
  const numbers = notes.numbers.filter((n) => ids.has(n.id));
  const plain = new Set([
    ...numbers.flatMap((n) => [...(index.keysById.get(n.id) ?? [])]),
    ...said,
  ]);
  const seconds = new Set(
    numbers.flatMap((n) => {
      const factor = SECONDS_PER_UNIT[n.unit.trim().toLowerCase()];
      if (factor === undefined) return [];
      return numberMentions(n.value).map((m) => numberKey(m.value * factor));
    }),
  );
  return { plain, seconds, shown: numbers.map((n) => `${n.value} ${n.unit}`.trim()) };
}

function citedIds(spec: RenderableVideoSpec, beatId: string): string[] {
  const beat = spec.story.beats.find((b) => b.id === beatId);
  const script = spec.script.find((s) => s.beatId === beatId);
  return [
    ...(beat?.factIds.filter((id) => id.startsWith('num-')) ?? []),
    ...(beat?.hookNumberIds ?? []),
    ...(script?.statCards.map((c) => c.sourceRef) ?? []),
  ];
}

function saidKeys(spec: RenderableVideoSpec, beatId: string): string[] {
  const script = spec.script.find((s) => s.beatId === beatId);
  if (!script) return [];
  const texts = [
    script.narration,
    script.source ?? '',
    ...script.tags,
    ...script.statCards.flatMap((c) => [c.value, c.label]),
  ];
  return texts.flatMap(countedKeys);
}

function numberChecks(
  spec: RenderableVideoSpec,
  notes: ResearchNotes,
  i: number,
  leaves: readonly WrittenLeaf[],
): SpecError[] {
  const allowed = allowedValues(spec, notes, i);
  const list = allowed.shown.length > 0 ? allowed.shown.join(', ') : 'none';
  const hint =
    `Show only research numbers of this beat or earlier on this board (${list}); never one ` +
    'you worked out.';
  return leaves.flatMap((leaf) => {
    if (leaf.kind === 'number') {
      const key = numberKey(leaf.value);
      const ok = leaf.unit === 'sec' ? allowed.seconds.has(key) : allowed.plain.has(key);
      if (ok || EVERYDAY_VALUES.has(key)) return [];
      const shown = leaf.unit === 'sec' ? `${leaf.value} s` : String(leaf.value);
      return [
        warning(
          leaf.path,
          'screen_number_not_in_notes',
          `${shown} is not a research value. ${hint}`,
        ),
      ];
    }
    if (leaf.kind !== 'text') return [];
    const unknown = countedKeys(leaf.value).filter((k) => !allowed.plain.has(k));
    if (unknown.length === 0) return [];
    return [
      warning(
        leaf.path,
        'screen_number_not_in_notes',
        `"${leaf.value}" shows ${unknown.join(', ')}, not a research value. ${hint}`,
      ),
    ];
  });
}

/** No label names a glossary term before the beat that introduces it. */
function termChecks(
  spec: RenderableVideoSpec,
  i: number,
  leaves: readonly WrittenLeaf[],
): SpecError[] {
  const { beats } = spec.story;
  const known = new Set(
    beats.slice(0, i + 1).flatMap((b) => b.newTerms.map((t) => t.toLowerCase())),
  );
  const later = beats
    .slice(i + 1)
    .flatMap((b) =>
      b.newTerms.filter((t) => !known.has(t.toLowerCase())).map((term) => ({ term, beatId: b.id })),
    );
  return leaves.flatMap((leaf) => {
    if (leaf.kind !== 'text') return [];
    const early = later.find(({ term }) => mentionsTerm(leaf.value, term));
    if (!early) return [];
    return [
      warning(
        leaf.path,
        'label_term_too_early',
        `"${leaf.value}" names "${early.term}", which beat ${early.beatId} introduces later. ` +
          'Use a plain word for it here.',
      ),
    ];
  });
}

/** In an `exampleNumbers` beat, a label with a number reads as an example: "e.g. ...". */
function exampleChecks(beat: StoryBeat | undefined, leaves: readonly WrittenLeaf[]): SpecError[] {
  if (!beat?.exampleNumbers) return [];
  return leaves.flatMap((leaf) => {
    if (leaf.kind !== 'text' || countedKeys(leaf.value).length === 0) return [];
    if (leaf.value.trim().toLowerCase().startsWith(EXAMPLE_LABEL_PREFIX)) return [];
    return [
      warning(
        leaf.path,
        'example_label_unmarked',
        `This beat's numbers are an example: start the label with "${EXAMPLE_LABEL_PREFIX}" ` +
          `("${EXAMPLE_LABEL_PREFIX} ${leaf.value.trim()}"), so it is not read as a fact.`,
      ),
    ];
  });
}
