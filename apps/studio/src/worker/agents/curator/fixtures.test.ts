import { describe, expect, it } from 'vitest';
import { fixtureGeneratedSpec } from '../generator/testing.ts';
import { CURATOR_SEEDS, seededSpec } from './fixtures.ts';

describe('CURATOR_SEEDS', () => {
  it('plants one seed per review category (visual_distracts aside)', () => {
    const categories = CURATOR_SEEDS.map((s) => s.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it.each(CURATOR_SEEDS.map((s) => [s.id, s] as const))(
    '%s keeps the spec renderable',
    (_, seed) => {
      const spec = seededSpec(fixtureGeneratedSpec(seed.topic), seed);
      expect(spec.scenes.length).toBeGreaterThan(0);
    },
  );
});
