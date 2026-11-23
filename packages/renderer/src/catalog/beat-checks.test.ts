import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  goldenFixtures,
  goldenRateLimiterSpec,
  patternBoardSpecs,
  withFormat,
} from '../../fixtures/index.ts';
import { analyse } from '../layout/analyse.ts';
import { beatLayoutMode, LAYOUT_MODES } from '../layout/modes.ts';
import { elementState } from '../primitives/element-state.ts';
import { beatWorld, sceneChain } from '../scene/beat-world.ts';
import { getTheme } from '../theme/index.ts';
import {
  beatCheckWarnings,
  MAX_BOARD_UNITS,
  MAX_UNRELATED_CHANGES_PER_WORD,
} from './beat-checks.ts';
import { DEFAULT_REGISTRIES } from './registries.ts';
import { settledSec } from './settled.ts';

type Scenes = RenderableVideoSpec['scenes'];

/** The golden rate limiter with its scenes changed. */
function golden(change: (scenes: Scenes, spec: RenderableVideoSpec) => void): RenderableVideoSpec {
  const spec = structuredClone(goldenRateLimiterSpec);
  change(spec.scenes, spec);
  return spec;
}

const scene = (scenes: Scenes, i: number) => {
  const found = scenes[i];
  if (!found) throw new Error(`no scene ${i}`);
  return found;
};

function codes(spec: RenderableVideoSpec): string[] {
  return beatCheckWarnings(spec).map((w) => `${w.path} ${w.code}`);
}

describe('beatCheckWarnings: the golden fixtures pass', () => {
  it.each(
    goldenFixtures.flatMap(
      ({ spec }) =>
        [
          [`${spec.meta.id} full`, spec],
          [`${spec.meta.id} card`, withFormat(spec, 'card')],
        ] as const,
    ),
  )('%s', (_, spec) => {
    expect(codes(spec)).toEqual([]);
  });
});

describe('focus_missing', () => {
  it('flags a board with no focus and no focus event', () => {
    const spec = golden((s) => (scene(s, 2).focus = []));
    expect(codes(spec)).toContain('$.scenes[2].focus focus_missing');
  });

  it('accepts a focus event instead, and a continuing beat inheriting its board’s focus', () => {
    const spec = golden((s) => {
      const bucket = scene(s, 2);
      bucket.focus = [];
      bucket.events.push({ at: { type: 'word', index: 3 }, action: 'focus', targets: ['tokens'] });
    });
    expect(codes(spec).filter((c) => c.includes('focus_missing'))).toEqual([]);
    expect(scene(goldenRateLimiterSpec.scenes, 5).focus).toEqual([]);
  });
});

describe('beat_without_motion', () => {
  it('flags a beat with no events and no pattern', () => {
    const spec = golden((s) => (scene(s, 2).events = []));
    expect(codes(spec)).toContain('$.scenes[2].events beat_without_motion');
  });

  it('counts a pattern as motion (it animates on its anchors)', () => {
    expect(scene(goldenRateLimiterSpec.scenes, 1).events.length).toBeGreaterThan(0);
    const spec = golden((s) => (scene(s, 1).events = []));
    expect(codes(spec).filter((c) => c.includes('beat_without_motion'))).toEqual([]);
  });
});

describe('beat_without_change', () => {
  it('flags a continuing beat that adds nothing, keeps the focus and the camera', () => {
    const spec = golden((s) => {
      const fix = scene(s, 5);
      fix.elements = [];
      fix.events = fix.events.filter((e) => e.action === 'exit');
    });
    expect(codes(spec)).toContain('$.scenes[5] beat_without_change');
  });

  it('accepts a continuing beat that only moves the focus', () => {
    const spec = golden((s) => {
      const fix = scene(s, 5);
      fix.elements = [];
      fix.events = [{ at: { type: 'word', index: 2 }, action: 'focus', targets: ['api-a'] }];
    });
    expect(codes(spec).filter((c) => c.includes('beat_without_change'))).toEqual([]);
  });

  it('flags an empty new board', () => {
    const spec = golden((s) => {
      Object.assign(scene(s, 2), { elements: [], events: [] });
    });
    expect(codes(spec)).toContain('$.scenes[2] beat_without_change');
  });
});

describe('zoom_from_unplanned', () => {
  const zoom = (device: string | undefined) =>
    golden((s, spec) => {
      Object.assign(scene(s, 4), { transitionIn: 'zoom-in', zoomFrom: 'redis' });
      const beat = spec.story.beats[4];
      if (beat) beat.device = device;
    });

  it('flags zoomFrom on a beat the plan does not mark semantic_zoom', () => {
    expect(codes(zoom(undefined))).toContain('$.scenes[4].zoomFrom zoom_from_unplanned');
  });

  it('accepts it on a semantic_zoom beat', () => {
    expect(codes(zoom('semantic_zoom')).filter((c) => c.includes('zoom_from'))).toEqual([]);
  });
});

describe('events_share_word', () => {
  const word = { type: 'word', index: 4 } as const;

  it(`flags more than ${MAX_UNRELATED_CHANGES_PER_WORD} unrelated changes on one word`, () => {
    const spec = golden((s) => {
      scene(s, 0).events.push(
        { at: word, action: 'pulse', targets: ['script'] },
        { at: word, action: 'pulse', targets: ['api'] },
        { at: word, action: 'pulse', targets: ['rps'] },
      );
    });
    expect(codes(spec).some((c) => c.endsWith('events_share_word'))).toBe(true);
  });

  it('accepts related changes on one word (shared targets form one change)', () => {
    const spec = golden((s) => {
      scene(s, 0).events.push(
        { at: word, action: 'pulse', targets: ['script', 'api'] },
        { at: word, action: 'highlight', targets: ['api'] },
        { at: word, action: 'pulse', targets: ['rps'] },
      );
    });
    expect(codes(spec).filter((c) => c.endsWith('events_share_word'))).toEqual([]);
  });
});

describe('events_under_ending_card', () => {
  const last = goldenRateLimiterSpec.scenes.length - 1;
  const narration = goldenRateLimiterSpec.script.at(-1)?.narration ?? '';
  const lastWord = narration.split(/\s+/).length - 1;

  it("flags an event anchored in the final beat's last sentence", () => {
    const spec = golden((s) =>
      scene(s, last).events.push({
        at: { type: 'word', index: lastWord },
        action: 'pulse',
        targets: ['flood'],
      }),
    );
    expect(codes(spec)).toContain(`$.scenes[${last}].events[1].at events_under_ending_card`);
  });

  it('flags a pattern anchor there too, and nothing without an ending card', () => {
    const spec = golden((s) => {
      const params = scene(s, last).patterns[0]?.params as { at: Record<string, unknown> };
      params.at.funnel = { type: 'word', index: lastWord };
    });
    expect(codes(spec)).toContain(
      `$.scenes[${last}].patterns[0].params.at.funnel events_under_ending_card`,
    );
    const noCard = structuredClone(spec);
    noCard.story.ending = { kind: 'callback_ending' };
    expect(codes(noCard).filter((c) => c.endsWith('events_under_ending_card'))).toEqual([]);
  });
});

describe('board_too_busy', () => {
  it(`flags more than ${MAX_BOARD_UNITS} things on screen at once`, () => {
    const spec = golden((s) => {
      const extra = Array.from({ length: 4 }, (_, k) => ({
        id: `extra-${k}`,
        primitive: 'node_card',
        props: { title: `<example-${k}>` },
      }));
      scene(s, 4).elements.push(...extra);
    });
    expect(codes(spec)).toContain('$.scenes[4] board_too_busy');
  });

  it(`is calibrated: the busiest golden or pattern board shows exactly ${MAX_BOARD_UNITS}`, () => {
    const specs = [...goldenFixtures.map((f) => f.spec), ...patternBoardSpecs];
    const busiest = Math.max(
      ...specs.flatMap((spec) => spec.scenes.map((s) => shownAtSettle(spec, s.beatId))),
    );
    expect(busiest).toBe(MAX_BOARD_UNITS);
  });
});

describe('highlight_everything', () => {
  it('flags a highlight covering every unit of a full board', () => {
    const spec = golden((s) =>
      scene(s, 3).events.push({
        at: { type: 'word', index: 12 },
        action: 'highlight',
        targets: ['api', 'redis', 'cmd', 'ttl'],
      }),
    );
    expect(codes(spec).some((c) => c.endsWith('highlight_everything'))).toBe(true);
  });

  it('accepts a highlight on one thing', () => {
    const spec = golden((s) =>
      scene(s, 3).events.push({
        at: { type: 'word', index: 12 },
        action: 'highlight',
        targets: ['redis'],
      }),
    );
    expect(codes(spec).filter((c) => c.endsWith('highlight_everything'))).toEqual([]);
  });
});

/** Units on screen when a beat has settled, counted as `board_too_busy` counts them. */
function shownAtSettle(spec: RenderableVideoSpec, beatId: string): number {
  const timing = effectiveTiming(spec);
  const first = sceneChain(spec.scenes, beatId)[0];
  const mode = first
    ? LAYOUT_MODES.get(beatLayoutMode(first, DEFAULT_REGISTRIES.patterns))
    : undefined;
  const beat = timing.beats.find((b) => b.beatId === beatId);
  if (!mode || !beat) return 0;
  const items = beatWorld(spec, timing, beatId, 30, DEFAULT_REGISTRIES);
  const events = items.flatMap((i) => (i.kind === 'primitive' ? i.events : []));
  const sec = settledSec(events.filter((e) => e.sec >= beat.startSec)) ?? beat.endSec;
  const shown = items.filter(
    (i) => i.kind === 'primitive' && elementState(i.events, Math.round(sec * 30), 30).presence > 0,
  );
  const overlayChildren = shown.flatMap((i) =>
    i.kind === 'primitive' && i.layer === 'overlay' ? i.children : [],
  );
  return analyse(shown, mode, new Set(), getTheme()).units.length + overlayChildren.length;
}
