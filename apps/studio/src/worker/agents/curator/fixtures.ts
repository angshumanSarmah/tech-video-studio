import { join } from 'node:path';
import {
  narrationWords,
  validateRenderableVideoSpec,
  type CuratorIssue,
  type CuratorOwner,
  type EventAnchor,
  type RenderableVideoSpec,
  type ReviewCategory,
} from '@explainer-studio/shared';
import { fixtureResponsesDir, type FixtureTopicId } from '../fixture-topics.ts';

/**
 * The Curator's fixture eval (P1C.8): what the review must find in each recorded topic, what it
 * may find, the correct lines it must not flag, and the seeded faults (one wrong thing planted
 * in a recorded spec per review category). `curator:fixture` runs the review live and prints the
 * eval; `--record` keeps the answers and the eval, which `jobs/curate.test.ts` replays. All text
 * is invented, like the fixtures. Not imported by any entrypoint.
 */

/** Which issues an expectation matches: all given fields must hold. */
export interface IssueMatch {
  readonly beatId?: string;
  readonly categories: readonly ReviewCategory[];
  /** The issue's owner is one of these. */
  readonly owners?: readonly CuratorOwner[];
  /** Some evidence item names this element, or quotes text containing this (any case). */
  readonly evidence?: { readonly elementId?: string; readonly quote?: string };
}

export interface Expectation {
  readonly id: string;
  readonly why: string;
  readonly match: IssueMatch;
}

/** A correct line: flagged only by a matching issue whose owner is not in `allowedOwners`. */
export interface MustNotFlag extends Expectation {
  readonly allowedOwners?: readonly CuratorOwner[];
}

export interface TopicExpectations {
  readonly mustFind: readonly Expectation[];
  /** Real but debatable findings: reported, never a failure. */
  readonly mayFind: readonly Expectation[];
  readonly mustNotFlag: readonly MustNotFlag[];
}

const CLAIMS: readonly ReviewCategory[] = [
  'unsupported_claim',
  'wrong_simplification',
  'number_wrong_meaning',
];

export const TOPIC_EXPECTATIONS: Readonly<Record<FixtureTopicId, TopicExpectations>> = {
  'rate-limiter': {
    mustFind: [
      {
        id: 'capacity-label',
        why: 'beat2\'s counter is labelled "capacity" but goes 100 -> 99: the capacity stays 100, 99 is the tokens left',
        match: {
          beatId: 'beat2',
          categories: ['number_wrong_meaning', 'visual_contradicts'],
          evidence: { elementId: 'bucket' },
        },
      },
      {
        id: 'median-p99-as-change',
        why: "beat5 draws the median and p99 round trips (0.4, 2.1 ms) as a change over time beside 'slow store'",
        match: {
          beatId: 'beat5',
          categories: ['visual_contradicts', 'number_wrong_meaning', 'wrong_simplification'],
          evidence: { elementId: 'latency' },
        },
      },
    ],
    mayFind: [
      {
        id: 'limiter-let-them-fail',
        why: 'beat1: the provider throttled; the limiter let too much traffic through (fact-18, fact-21)',
        match: { beatId: 'beat1', categories: ['wrong_simplification', 'unsupported_claim'] },
      },
      {
        id: 'bucket-per-request',
        why: 'beat2 "Each checkout request gets a key and a token bucket": the bucket is per key, not per request (fact-1, fact-4)',
        match: { beatId: 'beat2', categories: ['wrong_simplification', 'unsupported_claim'] },
      },
      {
        id: 'percentiles-above-level',
        why: 'beat5: "median" and "p ninety-nine" unexplained at beginner',
        match: { beatId: 'beat5', categories: ['above_level'] },
      },
      {
        id: 'failover-above-level',
        why: 'beat6: "failover", "replica in another zone" unexplained at beginner',
        match: { beatId: 'beat6', categories: ['above_level'] },
      },
      {
        id: 'fail-open-trade-off',
        why: 'why fail open was chosen (fact-22) and what failing closed costs',
        match: { categories: ['missing_trade_off'] },
      },
    ],
    mustNotFlag: [
      {
        id: 'forty-times',
        why: 'beat7 "forty times its contracted rate" is fact-20, although num-18 (40) is a count',
        match: {
          beatId: 'beat7',
          categories: CLAIMS,
          owners: ['scriptwriter'],
          evidence: { quote: 'forty' },
        },
      },
      {
        id: 'say-a-hundred',
        why: 'beat2 frames the field guide\'s bucket size as an example ("Say the bucket holds a hundred")',
        match: {
          beatId: 'beat2',
          categories: CLAIMS,
          owners: ['scriptwriter'],
          evidence: { quote: 'say' },
        },
      },
      {
        id: 'say-twenty-four',
        why: 'beat3 frames the field guide\'s node count as an example ("say, twenty-four nodes")',
        match: {
          beatId: 'beat3',
          categories: CLAIMS,
          owners: ['scriptwriter'],
          evidence: { quote: 'say' },
        },
      },
      {
        id: 'say-the-median',
        why: 'beat5 "Say the median…" is the plan\'s exampleNumbers: Director-owned, to the gate',
        match: { beatId: 'beat5', categories: CLAIMS, evidence: { quote: 'say' } },
        allowedOwners: ['director'],
      },
    ],
  },
  tokenizer: {
    mustFind: [
      {
        id: 'corrowby-bills',
        why: 'b6 "Corrowby bills every request in tokens": Corrowby is billed by the token (fact-21)',
        match: { beatId: 'b6', categories: ['unsupported_claim', 'wrong_simplification'] },
      },
      {
        id: 'reply-now-fits',
        why: 'b7 "That reply with Paris now fits.": no fact says it did not fit, or now does',
        match: {
          beatId: 'b7',
          categories: ['unsupported_claim'],
          evidence: { quote: 'fits' },
        },
      },
    ],
    mayFind: [
      {
        id: 'three-token-counts',
        why: 'b1 "three token counts": the counts are one, one and three (num-7), two distinct values',
        match: { beatId: 'b1', categories: ['unsupported_claim', 'wrong_simplification'] },
      },
      {
        id: 'vocabulary-size-trade-off',
        why: 'a larger vocabulary shortens sequences but costs embedding rows (fact-11, fact-12)',
        match: { categories: ['missing_trade_off'] },
      },
    ],
    mustNotFlag: [
      {
        id: 'ratio-stat-card',
        why: 'b6\'s "about 1.3" tokens per word is a ratio and the beat\'s point, not a small count',
        match: { beatId: 'b6', categories: ['small_stat_card'] },
      },
    ],
  },
};

// --- Seeded faults ------------------------------------------------------------------------------

export interface CuratorSeed {
  readonly id: string;
  readonly topic: FixtureTopicId;
  readonly category: ReviewCategory;
  /** What is planted, in a phrase. */
  readonly what: string;
  readonly apply: (spec: RenderableVideoSpec) => void;
  readonly expect: IssueMatch;
}

type Scene = RenderableVideoSpec['scenes'][number];

function sceneOf(spec: RenderableVideoSpec, beatId: string): Scene {
  const scene = spec.scenes.find((s) => s.beatId === beatId);
  if (!scene) throw new Error(`No scene ${beatId}`);
  return scene;
}

function scriptOf(spec: RenderableVideoSpec, beatId: string) {
  const script = spec.script.find((s) => s.beatId === beatId);
  if (!script) throw new Error(`No script ${beatId}`);
  return script;
}

/**
 * Replaces `from` with `to` in a beat's narration and keeps its board's word anchors on the same
 * words (those after the change move by the word difference; those on a replaced word move to the
 * replacement's last word). The spec loses its timing layer:
 * the audio no longer matches, so timing is estimated, as before TTS.
 */
function editNarration(spec: RenderableVideoSpec, beatId: string, from: string, to: string): void {
  const script = scriptOf(spec, beatId);
  const at = script.narration.indexOf(from);
  if (at < 0) throw new Error(`"${from}" is not in ${beatId}'s narration`);
  const start = narrationWords(script.narration.slice(0, at)).length;
  const removed = narrationWords(from).length;
  const added = narrationWords(to).length;
  const delta = added - removed;
  script.narration = script.narration.slice(0, at) + to + script.narration.slice(at + from.length);
  const shift = (anchor: EventAnchor): EventAnchor => {
    if (anchor.type !== 'word' || anchor.index < start) return anchor;
    if (anchor.index >= start + removed) return { ...anchor, index: anchor.index + delta };
    return { ...anchor, index: start + Math.max(0, added - 1) };
  };
  shiftAnchors(sceneOf(spec, beatId), shift);
  delete spec.timing;
}

function shiftAnchors(scene: Scene, shift: (anchor: EventAnchor) => EventAnchor): void {
  for (const event of scene.events) event.at = shift(event.at);
  for (const pattern of scene.patterns) {
    const at = (pattern.params as { at?: Record<string, EventAnchor> }).at;
    if (at) for (const name of Object.keys(at)) at[name] = shift(at[name]!);
  }
}

const word = (index: number): EventAnchor => ({ type: 'word', index });

export const CURATOR_SEEDS: readonly CuratorSeed[] = [
  {
    id: 'unsupported-claim',
    topic: 'rate-limiter',
    category: 'unsupported_claim',
    what: 'beat6 adds a cause no source gives (the replica ran out of memory)',
    apply: (spec) =>
      editNarration(
        spec,
        'beat6',
        'counted as a failure.',
        'counted as a failure. The replica had run out of memory.',
      ),
    expect: { beatId: 'beat6', categories: ['unsupported_claim'], evidence: { quote: 'memory' } },
  },
  {
    id: 'wrong-simplification',
    topic: 'rate-limiter',
    category: 'wrong_simplification',
    what: 'beat4 says the store locks every bucket for a second (it runs one atomic script)',
    apply: (spec) =>
      editNarration(
        spec,
        'beat4',
        'Both let their request through.',
        'Both let their request through. So the store locks every bucket for a whole second.',
      ),
    expect: {
      beatId: 'beat4',
      categories: ['wrong_simplification', 'unsupported_claim'],
      evidence: { quote: 'lock' },
    },
  },
  {
    id: 'number-wrong-meaning',
    topic: 'rate-limiter',
    category: 'number_wrong_meaning',
    what: 'beat7 shows a counter "provider limit: 40 req/s" (40 is the instance count; the contract is 300 req/s)',
    apply: (spec) => {
      const scene = sceneOf(spec, 'beat7');
      scene.elements.push({
        id: 'provider-limit',
        primitive: 'counter',
        props: {
          value: 40,
          unit: 'req/s',
          label: 'provider limit',
          semantic: 'problem',
          pin: { to: 'hub', side: 'bottom' },
        },
      });
      scene.events.push({ at: word(31), action: 'enter', targets: ['provider-limit'] });
    },
    expect: {
      beatId: 'beat7',
      categories: ['number_wrong_meaning'],
      evidence: { elementId: 'provider-limit' },
    },
  },
  {
    id: 'visual-contradicts',
    topic: 'rate-limiter',
    category: 'visual_contradicts',
    what: 'beat3 draws the shared store, the fix, as a problem and rejects it',
    apply: (spec) => {
      const scene = sceneOf(spec, 'beat3');
      const store = scene.elements.find((e) => e.id === 'store_node');
      if (!store) throw new Error('No store_node in beat3');
      store.props.semantic = 'problem';
      scene.events.push({ at: word(27), action: 'reject', targets: ['store_node'] });
    },
    expect: {
      beatId: 'beat3',
      categories: ['visual_contradicts'],
      evidence: { elementId: 'store_node' },
    },
  },
  {
    id: 'hook-retold',
    topic: 'rate-limiter',
    category: 'hook_retold',
    what: "beat7 retells the hook's outage in words (no hook number, so no code check catches it)",
    apply: (spec) =>
      editNarration(
        spec,
        'beat7',
        'Checkouts started failing.',
        'Once again, checkout failed for most of an hour, and a third of payments broke.',
      ),
    expect: { beatId: 'beat7', categories: ['hook_retold'] },
  },
  {
    id: 'term-before-shown',
    topic: 'rate-limiter',
    category: 'term_before_shown',
    what: 'beat3 names the shared store first; the board shows it only on its last word',
    apply: (spec) => {
      editNarration(spec, 'beat3', 'So why not', 'A shared store fixes this. So why not');
      const scene = sceneOf(spec, 'beat3');
      const last = narrationWords(scriptOf(spec, 'beat3').narration).length - 1;
      for (const event of scene.events) {
        const late = event.targets.some((t) => t === 'store_node' || t === 'shared_tag');
        if (late && (event.action === 'enter' || event.action === 'focus')) event.at = word(last);
      }
    },
    expect: { beatId: 'beat3', categories: ['term_before_shown'] },
  },
  {
    id: 'above-level',
    topic: 'rate-limiter',
    category: 'above_level',
    what: 'beat4 says the store needs "an atomic script" (a glossary term no beat introduces or glosses)',
    apply: (spec) =>
      editNarration(spec, 'beat4', 'read, refill and write as one step', 'an atomic script'),
    expect: { beatId: 'beat4', categories: ['above_level', 'term_before_shown'] },
  },
  {
    id: 'small-stat-card',
    topic: 'tokenizer',
    category: 'small_stat_card',
    what: 'b5 adds a stat card "3 / tokens for PARIS" (a small count the narration says)',
    apply: (spec) => {
      const card = { value: '3', label: 'tokens for PARIS', sourceRef: 'num-7' };
      scriptOf(spec, 'b5').statCards.push(card);
      const scene = sceneOf(spec, 'b5');
      scene.elements.push({
        id: 'caps-count',
        primitive: 'stat_card',
        props: {
          value: card.value,
          label: card.label,
          source: 'A field guide to subword merges',
          semantic: 'focus',
        },
      });
      scene.events.push({ at: word(31), action: 'enter', targets: ['caps-count'] });
    },
    expect: { beatId: 'b5', categories: ['small_stat_card'] },
  },
  {
    id: 'missing-trade-off',
    topic: 'rate-limiter',
    category: 'missing_trade_off',
    what: 'beat8 drops its last line, the only mention of what failing closed costs',
    apply: (spec) => editNarration(spec, 'beat8', ' So that checkout waits, or is refused.', ''),
    expect: { categories: ['missing_trade_off'] },
  },
];

export function curatorSeed(id: string): CuratorSeed {
  const seed = CURATOR_SEEDS.find((s) => s.id === id);
  if (!seed) {
    throw new Error(`Unknown seed "${id}"; one of ${CURATOR_SEEDS.map((s) => s.id).join(', ')}`);
  }
  return seed;
}

/** The seed planted in a copy of the spec, validated (a seed must keep the spec renderable). */
export function seededSpec(spec: RenderableVideoSpec, seed: CuratorSeed): RenderableVideoSpec {
  const copy = structuredClone(spec);
  seed.apply(copy);
  const result = validateRenderableVideoSpec(copy);
  if (!result.ok) {
    const errors = result.errors.map((e) => `${e.path} ${e.code}`).join('; ');
    throw new Error(`Seed ${seed.id} breaks the spec: ${errors}`);
  }
  return result.spec;
}

/** Where a seed's recorded review lives (`loadDryRunFixtures` reads the dir). */
export function seedResponsesDir(seed: CuratorSeed): string {
  return join(fixtureResponsesDir('curator', seed.topic), '..', 'seeds', seed.id);
}

/** The recorded eval of a topic (`eval.json`) or seed, next to its responses. */
export function evalPath(dir: string): string {
  return join(dir, 'eval.json');
}

// --- Evaluation -----------------------------------------------------------------------------------

export function matches(issue: CuratorIssue, match: IssueMatch): boolean {
  if (match.beatId !== undefined && issue.beatId !== match.beatId) return false;
  if (!match.categories.includes(issue.category)) return false;
  if (match.owners && !match.owners.includes(issue.owner)) return false;
  const wanted = match.evidence;
  if (!wanted) return true;
  return issue.evidence.some((e) => {
    const id = e.kind === 'label' ? e.elementId : undefined;
    const quote = 'quote' in e ? (e.quote ?? '') : '';
    const idOk = wanted.elementId === undefined || id === wanted.elementId;
    const quoteOk =
      wanted.quote === undefined || quote.toLowerCase().includes(wanted.quote.toLowerCase());
    return idOk && quoteOk;
  });
}

export interface TopicEval {
  readonly found: readonly string[];
  readonly missed: readonly string[];
  readonly mayFound: readonly string[];
  /** Must-not-flag ids, each with the issue that flagged it (`<beat> <category> <owner>`). */
  readonly flagged: readonly string[];
}

export function evaluateTopic(
  issues: readonly CuratorIssue[],
  expectations: TopicExpectations,
): TopicEval {
  const hit = (e: Expectation) => issues.some((i) => matches(i, e.match));
  const flagged = expectations.mustNotFlag.flatMap((rule) =>
    issues
      .filter((i) => matches(i, rule.match) && !(rule.allowedOwners ?? []).includes(i.owner))
      .map((i) => `${rule.id}: ${i.beatId} ${i.category} ${i.owner}`),
  );
  return {
    found: expectations.mustFind.filter(hit).map((e) => e.id),
    missed: expectations.mustFind.filter((e) => !hit(e)).map((e) => e.id),
    mayFound: expectations.mayFind.filter(hit).map((e) => e.id),
    flagged,
  };
}

/** Whether a seed's review caught it. */
export function seedCaught(issues: readonly CuratorIssue[], seed: CuratorSeed): boolean {
  return issues.some((i) => matches(i, seed.expect));
}
