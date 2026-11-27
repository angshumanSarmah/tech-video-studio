import { describe, expect, it } from 'vitest';
import { renderStoryCatalogues, STORY_CATALOGUES, storyCatalogueVersions } from './render.ts';

describe('renderStoryCatalogues', () => {
  it('is deterministic', () => {
    expect(renderStoryCatalogues()).toBe(renderStoryCatalogues());
  });

  it('matches the reviewed snapshot (review the diff when catalogue data changes)', async () => {
    await expect(`${renderStoryCatalogues()}\n`).toMatchFileSnapshot(
      './__snapshots__/story-catalogues.txt',
    );
  });

  it('starts with the catalogue versions and lists every id once, as a closed list', () => {
    const block = renderStoryCatalogues();
    expect(block.split('\n')[0]).toBe(
      'CATALOGUE VERSIONS: topic-classes@v2, devices@v1, layout-modes@v1, metaphor-worlds@v1',
    );
    expect(storyCatalogueVersions()).toBe(block.split('\n')[0]!.slice(20));
    const ids = block.match(/^- [a-z0-9_-]+/gm)?.map((line) => line.slice(2));
    expect(ids).toEqual(STORY_CATALOGUES.flatMap((c) => c.entries.map((e) => e.id)));
    expect(block.match(/^## .*\(exhaustive: use only these ids/gm)).toHaveLength(4);
  });
});
