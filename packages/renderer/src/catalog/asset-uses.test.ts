import {
  validateVideoSpec,
  type LogoFile,
  type MissingAsset,
  type VideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { assetContext } from '../assets/library.ts';
import { SEED_ASSETS } from '../assets/seed.ts';
import { mergeMissingAssets, missingAssets, specAssetUses } from './asset-uses.ts';
import { DEFAULT_REGISTRIES } from './registries.ts';
import { fixtureSpec } from './test-specs.ts';
import { withRegistryChecks } from './validate.ts';

const logo: LogoFile = {
  kind: 'logo',
  id: 'logo_example',
  mime: 'image/png',
  dataUri: 'data:image/png;base64,iVBORw0KGgo=',
};

/** The rate-limiter fixture with an unknown icon on `client`, a logo on `api` and one inside the pattern. */
function specWithGaps() {
  const input = fixtureSpec();
  Object.assign(input.scenes[0]?.elements?.[0] ?? {}, {
    props: { title: 'Client', icon: 'rocket_ship' },
  });
  Object.assign(input.scenes[0]?.elements?.[1] ?? {}, {
    props: { title: 'API', icon: 'logo_example' },
  });
  const flood = input.scenes[3]?.patterns?.[0] as { params: Record<string, unknown> };
  flood.params.target = { title: 'API', icon: 'rocket_ship' };
  return Object.assign(input, { logos: [{ id: 'logo_example', label: '<example-company>' }] });
}

function parse(input: unknown): VideoSpec {
  const result = validateVideoSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

describe('specAssetUses', () => {
  it('finds asset ids on loose elements and inside pattern expansions', () => {
    const uses = specAssetUses(parse(fixtureSpec()));
    expect(uses.map((u) => [u.beatId, u.id, u.element])).toEqual([
      ['payoff', 'user', 'flood/source'],
      ['payoff', 'shield', 'flood/layer'],
      ['payoff', 'server', 'flood/target'],
    ]);
    expect(uses[0]?.path).toEqual(['scenes', 3, 'patterns', 0, 'params']);
  });
});

describe('unknown_asset with logo slots', () => {
  it('accepts declared logo slots, filled or not, and warns about undeclared ones', () => {
    const declared = specWithGaps();
    const warnings = withRegistryChecks(validateVideoSpec(declared), declared).warnings;
    expect(warnings.map((w) => [w.path, w.code])).toEqual([
      ['$.scenes[0].elements[0].props.icon', 'unknown_asset'],
      ['$.scenes[3].patterns[0].params', 'unknown_asset'],
    ]);
    expect(warnings[0]?.message).toMatch(/Logo slots: logo_example\.$/);

    const undeclared = Object.assign(specWithGaps(), { logos: [] });
    const codes = withRegistryChecks(validateVideoSpec(undeclared), undeclared).warnings;
    expect(codes.map((w) => w.path)).toContain('$.scenes[0].elements[1].props.icon');
  });
});

describe('unknown_asset suggestions', () => {
  it('suggests the closest ids, ranking the family the prop implies first', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[0]?.elements?.[1] ?? {}, {
      props: { title: 'API', role: 'leader' },
    });
    const [warning] = withRegistryChecks(validateVideoSpec(input), input).warnings;
    expect(warning?.path).toBe('$.scenes[0].elements[1].props.role');
    expect(warning?.message).toMatch(
      /^Unknown asset "leader" \(drawn as a placeholder\)\. Closest approved ids: crown, /,
    );
    expect(warning?.message).toMatch(/See the asset list in your catalogue\.$/);
  });
});

describe('missingAssets', () => {
  it('lists unknown ids and unfilled logo slots with every beat that uses them', () => {
    const spec = parse(specWithGaps());
    expect(missingAssets(spec, assetContext(spec.logos, undefined))).toEqual([
      {
        id: 'rocket_ship',
        kind: 'asset',
        label: 'rocket ship',
        uses: [
          { beatId: 'hook', path: '$.scenes[0].elements[0].props.icon' },
          { beatId: 'payoff', path: '$.scenes[3].patterns[0].params' },
        ],
      },
      {
        id: 'logo_example',
        kind: 'logo',
        label: '<example-company>',
        uses: [{ beatId: 'hook', path: '$.scenes[0].elements[1].props.icon' }],
      },
    ]);
  });

  it('drops a logo slot once its file is supplied', () => {
    const spec = parse(specWithGaps());
    const ids = missingAssets(spec, assetContext(spec.logos, [...SEED_ASSETS, logo])).map(
      (m) => m.id,
    );
    expect(ids).toEqual(['rocket_ship']);
  });

  it('reports library ids the render was not given (the DB lacks them)', () => {
    const spec = parse(fixtureSpec());
    const missing = missingAssets(spec, assetContext(undefined, []), DEFAULT_REGISTRIES);
    expect(missing.map((m) => m.id)).toEqual(['user', 'shield', 'server']);
  });

  it('is empty for a spec whose assets all exist', () => {
    expect(missingAssets(parse(fixtureSpec()), assetContext(undefined, undefined))).toEqual([]);
  });
});

describe('mergeMissingAssets', () => {
  const item = (id: string, ...beats: string[]): MissingAsset => ({
    id,
    kind: 'asset',
    label: id,
    uses: beats.map((beatId) => ({ beatId, path: `$.${beatId}` })),
  });

  it('replaces the whole list after a whole-video render', () => {
    expect(mergeMissingAssets([item('a', 'b1')], [item('c', 'b2')])).toEqual([item('c', 'b2')]);
  });

  it('replaces only the rendered beats after a per-beat render', () => {
    const previous = [item('a', 'b1', 'b2'), item('gone', 'b2')];
    const current = [item('a', 'b2'), item('new', 'b2'), item('ignored', 'b3')];
    expect(mergeMissingAssets(previous, current, ['b2'])).toEqual([
      item('a', 'b1', 'b2'),
      item('new', 'b2'),
    ]);
  });

  it('drops an id once no beat uses it', () => {
    expect(mergeMissingAssets([item('a', 'b1')], [], ['b1'])).toEqual([]);
  });
});
