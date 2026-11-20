import { describe, expect, it } from 'vitest';
import { TOPIC_CLASSES } from '../spec/meta.ts';
import { CHAPTER_DISPLAY_DEVICES } from '../spec/hud.ts';
import { DEVICE_CATALOGUE, DEVICE_IDS, DeviceCatalogueSchema } from './devices.ts';
import { LAYOUT_MODE_CATALOGUE, LAYOUT_MODE_IDS } from './layout-modes.ts';
import { METAPHOR_WORLD_CATALOGUE, MetaphorWorldCatalogueSchema } from './metaphor-worlds.ts';
import { STORY_CATALOGUES } from './render.ts';
import { defineCatalogue } from './schema.ts';
import { TOPIC_CLASS_CATALOGUE, TopicClassCatalogueSchema } from './topic-classes.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('story catalogues', () => {
  it('are versioned, with entries exactly matching their id lists', () => {
    expect(STORY_CATALOGUES.map((c) => [c.id, c.version])).toEqual([
      ['topic-classes', 1],
      ['devices', 1],
      ['layout-modes', 1],
      ['metaphor-worlds', 1],
    ]);
    expect(TOPIC_CLASS_CATALOGUE.entries.map((e) => e.id)).toEqual([...TOPIC_CLASSES]);
    expect(DEVICE_CATALOGUE.entries.map((e) => e.id)).toEqual([...DEVICE_IDS]);
    expect(LAYOUT_MODE_CATALOGUE.entries.map((e) => e.id)).toEqual([...LAYOUT_MODE_IDS]);
    expect(METAPHOR_WORLD_CATALOGUE.entries).toHaveLength(7);
  });

  it('has 25 distinct narrative devices, including the chapter display devices', () => {
    expect(new Set(DEVICE_IDS).size).toBe(25);
    expect(new Set(DEVICE_CATALOGUE.entries.map((e) => e.name.toLowerCase())).size).toBe(25);
    for (const id of Object.values(CHAPTER_DISPLAY_DEVICES)) expect(DEVICE_IDS).toContain(id);
  });

  it('allows every layout mode in at least one topic class', () => {
    const allowed = new Set(TOPIC_CLASS_CATALOGUE.entries.flatMap((e) => e.allowedLayoutModes));
    expect([...LAYOUT_MODE_IDS].filter((id) => !allowed.has(id))).toEqual([]);
  });

  it('keeps catalogue text invented: no reference video products', () => {
    const text = JSON.stringify(STORY_CATALOGUES);
    for (const name of ['uber', 'cricbuzz', 'bookmyshow', 'flipkart', 'zomato']) {
      expect(text.toLowerCase()).not.toContain(name);
    }
  });
});

describe('catalogue schemas', () => {
  it('reject a missing, extra or reordered entry', () => {
    const missing = clone(DEVICE_CATALOGUE);
    missing.entries.pop();
    const reordered = clone(DEVICE_CATALOGUE);
    reordered.entries.reverse();
    const duplicated = clone(DEVICE_CATALOGUE);
    duplicated.entries.push(clone(duplicated.entries[0]!));
    for (const bad of [missing, reordered, duplicated]) {
      expect(issuePaths(DeviceCatalogueSchema.safeParse(bad))).toEqual(['entries']);
    }
  });

  it('reject an unknown id, a bad version and the wrong catalogue id', () => {
    const bad = clone(DEVICE_CATALOGUE) as {
      id: string;
      version: number;
      entries: { id: string }[];
    };
    bad.id = 'devicez';
    bad.version = 0;
    bad.entries[0]!.id = 'made_up_device';
    expect(issuePaths(DeviceCatalogueSchema.safeParse(bad))).toEqual(
      expect.arrayContaining(['id', 'version', 'entries.0.id']),
    );
  });

  it('reject multi-line or empty text', () => {
    const bad = clone(DEVICE_CATALOGUE);
    bad.entries[0]!.summary = 'line one\nline two';
    bad.entries[1]!.whenToUse = '   ';
    expect(issuePaths(DeviceCatalogueSchema.safeParse(bad))).toEqual([
      'entries.0.summary',
      'entries.1.whenToUse',
    ]);
  });

  it('reject unknown or repeated cross-references in topic classes', () => {
    const bad = clone(TOPIC_CLASS_CATALOGUE) as unknown as {
      entries: { allowedLayoutModes: string[]; preferredDevices: string[] }[];
    };
    bad.entries[0]!.allowedLayoutModes.push('spiral');
    bad.entries[1]!.preferredDevices.push(bad.entries[1]!.preferredDevices[0]!);
    expect(issuePaths(TopicClassCatalogueSchema.safeParse(bad))).toEqual([
      `entries.0.allowedLayoutModes.${TOPIC_CLASS_CATALOGUE.entries[0]!.allowedLayoutModes.length}`,
      'entries.1.preferredDevices',
    ]);
  });

  it('reject a metaphor world mapping a concept twice', () => {
    const bad = clone(METAPHOR_WORLD_CATALOGUE);
    bad.entries[0]!.mappings.push(clone(bad.entries[0]!.mappings[0]!));
    expect(issuePaths(MetaphorWorldCatalogueSchema.safeParse(bad))).toEqual(['entries.0.mappings']);
  });

  it('defineCatalogue throws a readable error on invalid data', () => {
    const bad = clone(DEVICE_CATALOGUE);
    bad.version = -1;
    expect(() => defineCatalogue(DeviceCatalogueSchema, bad)).toThrow(
      /Invalid catalogue.*version/s,
    );
  });
});
