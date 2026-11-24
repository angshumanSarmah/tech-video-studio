import type { RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenFixtures, goldenRateLimiterSpec, withFormat } from '../../fixtures/index.ts';
import { getTheme } from '../theme/index.ts';
import { onScreenTextWarnings } from './on-screen-text.ts';
import { specLayoutWarnings } from './spec-layout.ts';

type Scene = RenderableVideoSpec['scenes'][number];

const theme = getTheme();

const at = (spec: RenderableVideoSpec, i: number): Scene => {
  const scene = spec.scenes[i];
  if (!scene) throw new Error(`no scene ${i}`);
  return scene;
};

const word = (text: string) => ({ type: 'word_text' as const, text, occurrence: 1 });

/** Indexes of the golden rate limiter's `fleet` chain: `fleet` and its continuation `fleet-fix`. */
const FLEET = 4;
const FLEET_FIX = 5;
const FLEET_ITEMS = ['user', 'api-a', 'api-b', 'to-a', 'to-b', 'count-a', 'count-b'];

/**
 * The golden rate limiter in the card format with its `fleet` chain reworked: `fleet` shows the
 * two APIs (no counter), and `fleet-fix` adds `extras` wide cards below them instead of Redis.
 * Its board fits only below the readable scale; each beat's camera frames what it shows.
 * With `clearFirst`, `fleet` exits its items on its last word, so `fleet-fix` shows only its own.
 */
function fleetChain(extras: number, clearFirst: boolean): RenderableVideoSpec {
  const spec = structuredClone(goldenRateLimiterSpec);
  const fleet = at(spec, FLEET);
  const fix = at(spec, FLEET_FIX);
  fleet.elements = fleet.elements.filter((e) => e.id !== 'leak');
  fleet.events = fleet.events.filter((e) => !e.targets.includes('leak'));
  fleet.focus = ['api-a'];
  if (clearFirst) {
    fleet.events.push({ at: word('limit'), action: 'exit', targets: FLEET_ITEMS, params: {} });
  }
  const ids = Array.from({ length: extras }, (_, k) => `extra-${k}`);
  fix.elements = ids.map((id, k) => ({
    id,
    primitive: 'node_card',
    zone: 'stage',
    props: { title: `API ${k + 3}`, subtitle: 'one more copy of the API', icon: 'server' },
  }));
  fix.events = [{ at: word('servers'), action: 'enter', targets: ids, params: {} }];
  fix.focus = ids.slice(0, 1);
  return withFormat(spec, 'card');
}

const paths = (spec: RenderableVideoSpec) => onScreenTextWarnings(spec, theme).map((w) => w.path);

const chainTooSmall = (spec: RenderableVideoSpec) =>
  specLayoutWarnings(spec, theme).some(
    (w) => w.path === `$.scenes[${FLEET}]` && w.code === 'text_too_small',
  );

describe('onScreenTextWarnings', () => {
  it('passes every golden fixture beat in the full format', () => {
    for (const { spec } of goldenFixtures) expect(paths(spec)).toEqual([]);
  });

  it('clears a chain the layout finds too small when every beat zooms in enough', () => {
    const spec = fleetChain(1, true);
    expect(chainTooSmall(spec)).toBe(true);
    expect(paths(spec)).not.toContain(`$.scenes[${FLEET}]`);
    expect(paths(spec)).not.toContain(`$.scenes[${FLEET_FIX}]`);
  });

  it('flags only the beat whose camera has to show the whole chain', () => {
    const spec = fleetChain(1, false);
    expect(chainTooSmall(spec)).toBe(true);
    expect(paths(spec)).toContain(`$.scenes[${FLEET_FIX}]`);
    expect(paths(spec)).not.toContain(`$.scenes[${FLEET}]`);
    const warning = onScreenTextWarnings(spec, theme).find(
      (w) => w.path === `$.scenes[${FLEET_FIX}]`,
    );
    expect(warning?.code).toBe('text_too_small_on_screen');
    expect(warning?.message).toMatch(
      /labels are [\d.]+px \(board at \d+%, camera zoom ×1\.00\); readable needs 18px/,
    );
    expect(warning?.message).toContain('laid out once for beats fleet, fleet-fix');
    expect(warning?.message).toContain('Widest at full size');
  });

  it('flags every beat when even the closest framing is too small', () => {
    const spec = fleetChain(3, true);
    expect(paths(spec)).toEqual(
      expect.arrayContaining([`$.scenes[${FLEET}]`, `$.scenes[${FLEET_FIX}]`]),
    );
  });
});
