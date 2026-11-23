import { DEVICE_CATALOGUE, type DeviceEntry } from './devices.ts';
import { LAYOUT_MODE_CATALOGUE, type LayoutModeEntry } from './layout-modes.ts';
import { METAPHOR_WORLD_CATALOGUE, type MetaphorWorldEntry } from './metaphor-worlds.ts';
import { catalogueVersionTag } from './schema.ts';
import { TOPIC_CLASS_CATALOGUE, type TopicClassEntry } from './topic-classes.ts';

/**
 * The story catalogues as one compact prompt section: a version line, then one closed list per
 * catalogue, one line per entry, in file order. Pure and deterministic, so the block caches; the
 * renderer's `catalogueBlock()` appends primitives and patterns after it.
 */

export const STORY_CATALOGUES = [
  TOPIC_CLASS_CATALOGUE,
  DEVICE_CATALOGUE,
  LAYOUT_MODE_CATALOGUE,
  METAPHOR_WORLD_CATALOGUE,
] as const;

export function storyCatalogueVersions(): string {
  return STORY_CATALOGUES.map(catalogueVersionTag).join(', ');
}

export function renderStoryCatalogues(): string {
  return [
    `CATALOGUE VERSIONS: ${storyCatalogueVersions()}`,
    closedListSection('TOPIC CLASSES', TOPIC_CLASS_CATALOGUE.entries.map(topicClassLine)),
    closedListSection('NARRATIVE DEVICES', DEVICE_CATALOGUE.entries.map(deviceLine)),
    closedListSection('LAYOUT MODES', LAYOUT_MODE_CATALOGUE.entries.map(layoutModeLine)),
    closedListSection(
      'METAPHOR WORLDS',
      METAPHOR_WORLD_CATALOGUE.entries.map(metaphorWorldLine),
      'optional, at most one per video',
    ),
  ].join('\n\n');
}

/**
 * The layout modes alone, with their version line: the Generator's story part (P1C.7). It fills
 * a board in a mode the plan fixed, so it needs zones and capacities, not devices, topic classes
 * or metaphor worlds.
 */
export function renderLayoutModeCatalogue(): string {
  return [
    `CATALOGUE VERSIONS: ${catalogueVersionTag(LAYOUT_MODE_CATALOGUE)}`,
    closedListSection('LAYOUT MODES', LAYOUT_MODE_CATALOGUE.entries.map(layoutModeLine)),
  ].join('\n\n');
}

/** A closed-list heading, as every agent prompt states it, then its lines. */
export function closedListSection(title: string, lines: readonly string[], note?: string): string {
  const extra = note ? `; ${note}` : '';
  return [`## ${title} (exhaustive: use only these ids${extra})`, ...lines].join('\n');
}

function topicClassLine(e: TopicClassEntry): string {
  return (
    `- ${e.id} (${e.name}): ${e.summary} Examples: ${e.exampleTopics.join(', ')}. ` +
    `Layout modes, most typical first: ${e.allowedLayoutModes.join(', ')}. ` +
    `Preferred devices: ${e.preferredDevices.join(', ')}.`
  );
}

function deviceLine(e: DeviceEntry): string {
  return `- ${e.id} (${e.name}): ${e.summary} Use: ${e.whenToUse} Avoid: ${e.whenNotToUse}`;
}

function layoutModeLine(e: LayoutModeEntry): string {
  return (
    `- ${e.id}: ${e.summary} Use: ${e.whenToUse} ` +
    `Zones: ${e.zones.join(', ')}. Max elements: ${e.maxUnits}.`
  );
}

function metaphorWorldLine(e: MetaphorWorldEntry): string {
  const maps = e.mappings.map((m) => `${m.concept} = ${m.metaphor}`).join('; ');
  return (
    `- ${e.id} (${e.name}): ${e.summary} Use: ${e.whenToUse} Avoid: ${e.whenNotToUse} ` +
    `Maps: ${maps}.`
  );
}
