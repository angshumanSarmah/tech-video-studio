import type { VideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { rateLimiterSpec } from '../../fixtures/index.ts';
import { iconDrift, normaliseTitle, withIconSwaps } from './icon-drift.ts';

/** The 4-beat fixture with one card per beat: `cards[i]` = [title, icon] or undefined. */
function spec(cards: ([string, string] | undefined)[]): VideoSpec {
  const s = structuredClone(rateLimiterSpec) as VideoSpec;
  (s.scenes ?? []).forEach((scene, i) => {
    const card = cards[i];
    if (card) {
      scene.elements.push({
        id: `card-${i}`,
        primitive: 'node_card',
        props: { title: card[0], icon: card[1] },
      });
    }
  });
  return s;
}

const swaps = (s: VideoSpec, beatIds?: ReadonlySet<string>) =>
  iconDrift(s, undefined, beatIds ? { beatIds } : {}).map((x) => `${x.beatId} ${x.from}->${x.to}`);

describe('iconDrift', () => {
  it('gives one thing the icon used most (the live run: memory once, database three times)', () => {
    const s = spec([
      ['SHARED STORE', 'memory'],
      ['Shared store', 'database'],
      ['shared  store!', 'database'],
      ['SHARED STORE', 'database'],
    ]);
    const found = iconDrift(s);
    expect(found).toEqual([
      expect.objectContaining({
        beatId: 'hook',
        path: '$.scenes[0].elements[3].props.icon',
        title: 'SHARED STORE',
        from: 'memory',
        to: 'database',
      }),
    ]);
    const fixed = withIconSwaps(s, found);
    expect(fixed.scenes?.[0]?.elements[3]?.props).toMatchObject({ icon: 'database' });
    expect(iconDrift(fixed)).toEqual([]);
  });

  it('takes the earliest beat on a tie, and leaves one-beat or one-icon things alone', () => {
    expect(
      swaps(spec([undefined, ['Gateway node', 'server'], ['Gateway node', 'router']])),
    ).toEqual(['bucket-empty router->server']);
    expect(
      swaps(
        spec([
          ['Gateway', 'server'],
          ['Gateway', 'server'],
        ]),
      ),
    ).toEqual([]);
    expect(
      swaps(
        spec([
          ['Gateway', 'server'],
          ['Client', 'laptop'],
        ]),
      ),
    ).toEqual([]);
  });

  it('changes only the beats it is given, counting every beat', () => {
    const s = spec([
      ['Store', 'database'],
      ['Store', 'database'],
      ['Store', 'memory'],
      ['Store', 'memory'],
    ]);
    // A tie (two each): the earliest beat's id wins; only `payoff` may change.
    expect(swaps(s, new Set(['payoff']))).toEqual(['payoff memory->database']);
  });

  it('never changes a logo slot', () => {
    const s = {
      ...spec([
        ['Provider', 'logo_acme'],
        ['Provider', 'credit_card'],
      ]),
    };
    s.logos = [{ id: 'logo_acme', label: '<example-company>' }];
    // The logo use is left out, so "Provider" has one icon: nothing to unify either way.
    expect(swaps(s)).toEqual([]);
  });

  it('drops a request whose id the board no longer uses', () => {
    const s = spec([
      ['Vault', 'vault_door'],
      ['Vault', 'lock'],
      ['Vault', 'lock'],
    ]);
    s.scenes![0]!.missingAssetRequests = [
      { assetId: 'vault_door', description: 'A vault door.', family: 'security', closest: 'lock' },
    ];
    const fixed = withIconSwaps(s, iconDrift(s));
    expect(fixed.scenes?.[0]?.missingAssetRequests).toBeUndefined();
    expect(s.scenes?.[0]?.missingAssetRequests).toHaveLength(1);
  });
});

describe('normaliseTitle', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normaliseTitle('  Shared-store! ')).toBe(normaliseTitle('SHARED STORE'));
  });
});
