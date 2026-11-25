import { describe, expect, it } from 'vitest';
import {
  catalogueKey,
  quotedSpans,
  statedDurations,
  referenceRecordProblems,
  type ReferenceCheckContext,
} from './checks.ts';
import {
  backlogItems,
  mergeAvoidNames,
  referenceDevices,
  ReferenceRecordSchema,
  type ReferenceRecord,
} from './record.ts';

const ctx: ReferenceCheckContext = {
  primitiveIds: new Set(['node_card', 'tag', 'timer_ring', 'connector', 'statement_card']),
  patternIds: new Set(['atomic_lock', 'failover', 'split_brain']),
};

/** An invented record that passes every check. */
function record(overrides: Partial<ReferenceRecord> = {}): ReferenceRecord {
  return ReferenceRecordSchema.parse({
    title: 'many buyers racing for one item',
    series: ['system-design'],
    topicClass: 'product-design',
    format: 'full',
    hook: {
      kind: 'problem',
      device: 'contention_hook',
      shape: 'Several buyers reach for the last item at the same instant.',
    },
    arc: 'hook → roadmap → steps with a tracker → zoom out',
    videoDevices: ['roadmap'],
    beats: [
      {
        role: 'hook',
        summary: 'Buyers converge on one item from several apps.',
        devices: ['contention_hook'],
        primitives: ['node_card', 'tag'],
      },
      {
        role: 'step',
        summary: 'A tap locks the item with a hold timer; a second tap is rejected.',
        devices: ['race_reveal'],
        patterns: ['atomic_lock'],
        primitives: ['timer_ring'],
        layoutMode: 'centered_focus',
      },
      {
        role: 'ending',
        summary: 'The camera pulls back over everything built so far.',
        devices: ['real_world_closure'],
        continuesPrevious: true,
      },
    ],
    chapters: [{ beats: [1, 2], questionForm: false }],
    pacing: ['One idea per beat, each about the same length.'],
    unmapped: [
      {
        kind: 'primitive',
        name: 'seat_map',
        description: 'A grid of seats with rows and an aisle.',
        closest: 'node_card',
        buildable: 'yes',
      },
      {
        kind: 'other',
        name: 'turnstile_characters',
        description: 'Illustrated people walking through a gate.',
        buildable: 'no',
      },
    ],
    namesToAvoid: [{ text: 'Acme Tickets', kind: 'brand' }],
    ...overrides,
  });
}

function codes(value: unknown, context: ReferenceCheckContext = ctx): string[] {
  return referenceRecordProblems(value, context).map((p) => `${p.code} at ${p.path}`);
}

function withBeat(index: number, beat: Partial<ReferenceRecord['beats'][number]>): ReferenceRecord {
  const base = record();
  const beats = base.beats.map((b, i) => (i === index ? { ...b, ...beat } : b));
  return { ...base, beats };
}

describe('referenceRecordProblems', () => {
  it('passes a clean record', () => {
    expect(codes(record())).toEqual([]);
  });

  it('ignores a value that fails the schema (the schema reports it)', () => {
    expect(codes({ title: 'x' })).toEqual([]);
  });

  it('flags pattern, primitive and closest ids not in the registry', () => {
    const bad = withBeat(1, { patterns: ['atomic_locks'], primitives: ['stopwatch'] });
    bad.unmapped = [{ ...bad.unmapped[0]!, closest: 'seat_grid' }];
    expect(codes(bad)).toEqual([
      'unknown_reference at $.beats[1].patterns[0]',
      'unknown_reference at $.beats[1].primitives[0]',
      'unknown_reference at $.unmapped[0].closest',
    ]);
  });

  it('flags a missing item the catalogue already has, and duplicates', () => {
    const base = record();
    const bad = {
      ...base,
      unmapped: [
        { ...base.unmapped[0]!, name: 'split-brains' },
        { ...base.unmapped[0]!, name: 'seat_maps' },
        { ...base.unmapped[0]!, name: 'seat_map' },
      ],
    };
    expect(codes(bad)).toEqual([
      'unmapped_is_registered at $.unmapped[0].name',
      'unmapped_duplicate at $.unmapped[2].name',
    ]);
  });

  it('flags a missing item the renderer draws by itself', () => {
    const base = record();
    const bad = {
      ...base,
      unmapped: [
        { ...base.unmapped[0]!, name: 'framed_caption_chrome' },
        { ...base.unmapped[0]!, name: 'non_focus_dimming' },
        { ...base.unmapped[0]!, name: 'stamp_effect' },
      ],
    };
    expect(codes(bad)).toEqual([
      'unmapped_is_built_in at $.unmapped[0].name',
      'unmapped_is_built_in at $.unmapped[1].name',
    ]);
  });

  it('keeps whole-video devices off beats and the hook device on the first beat', () => {
    const onBeat = withBeat(1, { devices: ['hero_metric'] });
    expect(codes(onBeat)).toEqual(['whole_video_device_on_beat at $.beats[1].devices[0]']);
    const hookless = withBeat(0, { devices: ['persona_hook'] });
    expect(codes(hookless)).toEqual(['hook_device_missing at $.hook.device']);
  });

  it('flags a chapter pointing past the beats', () => {
    expect(codes(record({ chapters: [{ beats: [1, 3], questionForm: true }] }))).toEqual([
      'chapter_beat_out_of_range at $.chapters[0].beats[1]',
    ]);
  });

  it('takes a length only from the breakdown', () => {
    const breakdown = '- Series: System Design · Length: about 1:45';
    expect(codes(record({ lengthSec: 105 }), { ...ctx, breakdown })).toEqual([]);
    expect(codes(record({ lengthSec: 150 }), { ...ctx, breakdown })).toEqual([
      'length_not_in_breakdown at $.lengthSec',
    ]);
    expect(codes(record({ lengthSec: 150 }), ctx)).toEqual([]);
    expect(statedDurations('about 50 s, or 2 min, or 90 seconds')).toEqual([50, 120, 90]);
  });

  it('allows a quoted term, not a quoted line', () => {
    expect(codes(withBeat(1, { summary: 'A status tag flips to "sold out".' }))).toEqual([]);
    expect(
      codes(withBeat(1, { summary: 'A card asks "is the old leader really gone for good".' })),
    ).toEqual(['quoted_wording at $.beats[1].summary']);
  });

  it('flags six words in a row copied from a span the breakdown quotes', () => {
    const breakdown =
      'The card reads "promoting a new leader is easy but proving the old one is gone is hard".';
    const copied = withBeat(2, {
      summary: 'A contrast card: proving the old one is gone is hard.',
    });
    expect(codes(copied, { ...ctx, breakdown })).toEqual(['copied_wording at $.beats[2].summary']);
    expect(codes(copied, ctx)).toEqual([]);
    const own = withBeat(2, { summary: 'A contrast card: promotion is simple, proof is not.' });
    expect(codes(own, { ...ctx, breakdown })).toEqual([]);
  });

  it('flags a name to avoid in any structure field, the record’s or the person’s', () => {
    const named = withBeat(0, { summary: 'Buyers converge on one item in Acme Tickets.' });
    expect(codes(named)).toEqual(['name_in_structure at $.beats[0].summary']);
    const extra = withBeat(1, { summary: 'A tap locks the item; the hold expires in Ticketo.' });
    expect(codes(extra, { ...ctx, extraNames: [{ text: 'Ticketo', kind: 'brand' }] })).toEqual([
      'name_in_structure at $.beats[1].summary',
    ]);
  });

  it('reads capitalised words mid-sentence as names, generic acronyms aside', () => {
    expect(codes(withBeat(0, { summary: 'Buyers open Zippo and hit a CDN and an API.' }))).toEqual([
      'proper_noun at $.beats[0].summary',
    ]);
    expect(
      codes(withBeat(0, { summary: 'Requests reach a CDN, then the API, then 3D roads.' })),
    ).toEqual([]);
    expect(codes(withBeat(0, { summary: 'AcmeDB stores each hold.' }))).toEqual([
      'proper_noun at $.beats[0].summary',
    ]);
    expect(codes(record({ arc: 'Hook → Steps → Zoom out' }))).toEqual([]);
  });

  it('flags quantities in text, not identifiers', () => {
    expect(codes(withBeat(1, { summary: 'The hold lasts 10 minutes.' }))).toEqual([
      'digits_in_text at $.beats[1].summary',
    ]);
    expect(codes(withBeat(1, { summary: 'A 2D map, then an L7 balancer.' }))).toEqual([]);
  });
});

describe('record helpers', () => {
  it('lists devices in order of first use', () => {
    expect(referenceDevices(record())).toEqual([
      'contention_hook',
      'roadmap',
      'race_reveal',
      'real_world_closure',
    ]);
  });

  it('sends only buildable items to the backlog', () => {
    expect(backlogItems(record()).map((i) => i.name)).toEqual(['seat_map']);
  });

  it('merges names case-insensitively, first spelling kept', () => {
    expect(
      mergeAvoidNames(
        [{ text: 'Acme Tickets', kind: 'brand' }],
        [
          { text: 'acme  tickets', kind: 'brand' },
          { text: 'Ticketo', kind: 'brand' },
        ],
      ).map((n) => n.text),
    ).toEqual(['Acme Tickets', 'Ticketo']);
  });

  it('normalises names for the catalogue comparison', () => {
    expect(catalogueKey('Split-Brains')).toBe('split_brain');
    expect(catalogueKey('boxes')).toBe('box');
    expect(quotedSpans('a "b c" and “d” and ‘e f’')).toEqual(['b c', 'd', 'e f']);
  });
});
