import {
  effectiveTiming,
  toJsonPath,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import type { Registries } from '../catalog/registries.ts';
import { FIT_EPSILON_PX, textWidth } from '../fonts/measure-text.ts';
import type { ClippedLine } from '../primitives/types.ts';
import { beatWorld, type WorldItem } from '../scene/beat-world.ts';
import { footnoteText } from '../scene/source-footnote.ts';
import type { Theme } from '../theme/index.ts';
import { boxOf, type PlacedItem } from './types.ts';
import type { ChainLayout, SpecLayout } from './spec-layout.ts';

/**
 * `text_truncated`: text that would be cut off instead of shown whole. A primitive's
 * `clippedLines` at its placed box (container children included), and each beat's source line
 * against the footnote line reserved for its chain. Widths come from the font files
 * (`textWidth`), the room from the same function the component cuts with. Pure.
 */

export const TEXT_TRUNCATED = 'text_truncated';

/** Any fps works: only which items exist matters here. */
const WORLD_FPS = 30;

export function textTruncationWarnings(
  spec: RenderableVideoSpec,
  layout: SpecLayout,
  theme: Theme,
  registries: Registries,
): SpecError[] {
  return layout.chains.flatMap((chain) => [
    ...clippedLineWarnings(spec, chain, theme, registries),
    ...footnoteWarnings(spec, chain, theme),
  ]);
}

function clippedLineWarnings(
  spec: RenderableVideoSpec,
  chain: ChainLayout,
  theme: Theme,
  registries: Registries,
): SpecError[] {
  const lastBeat = chain.beatIds.at(-1) ?? '';
  const world = worldByKey(beatWorld(spec, effectiveTiming(spec), lastBeat, WORLD_FPS, registries));
  return flattenPlaced(chain.board.items).flatMap((placed) => {
    const item = world.get(placed.key);
    if (item?.kind !== 'primitive' || !item.definition.clippedLines) return [];
    const lines = item.definition.clippedLines(item.props, boxOf(placed), theme);
    return lines
      .filter((line) => cutOff(theme, line))
      .map((line) => elementWarning(spec, chain, placed.key, line, theme));
  });
}

function footnoteWarnings(
  spec: RenderableVideoSpec,
  chain: ChainLayout,
  theme: Theme,
): SpecError[] {
  const rect = chain.footnote;
  if (!rect) return [];
  return chain.beatIds.flatMap((beatId) => {
    const text = footnoteText(spec, beatId);
    const width = text === undefined ? 0 : textWidth(theme, 'footnote', text);
    if (text === undefined || width <= rect.width + FIT_EPSILON_PX) return [];
    const index = spec.script.findIndex((s) => s.beatId === beatId);
    return [
      {
        path: toJsonPath(['script', index, 'source']),
        code: TEXT_TRUNCATED,
        message:
          `Beat "${beatId}": the source line "${text}" is ${px(width)} wide, but the footnote ` +
          `line has ${px(rect.width)}; it would be cut off. Shorten the source.`,
      },
    ];
  });
}

function cutOff(theme: Theme, line: ClippedLine): boolean {
  return textWidth(theme, line.style, line.text) > line.room + FIT_EPSILON_PX;
}

/**
 * Points at the prop of the scene element that declares `key`, or at the pattern instance that
 * expands to it (`<instance>/<id>`).
 */
function elementWarning(
  spec: RenderableVideoSpec,
  chain: ChainLayout,
  key: string,
  line: ClippedLine,
  theme: Theme,
): SpecError {
  const origin = declaration(spec, chain, key);
  const path =
    origin.elementIndex !== undefined
      ? ['scenes', origin.sceneIndex, 'elements', origin.elementIndex, 'props', ...line.path]
      : [
          'scenes',
          origin.sceneIndex,
          ...(origin.patternIndex !== undefined ? ['patterns', origin.patternIndex] : []),
        ];
  const width = textWidth(theme, line.style, line.text);
  const where = origin.elementIndex !== undefined ? '' : ` (at ${line.path.join('.')})`;
  return {
    path: toJsonPath(path),
    code: TEXT_TRUNCATED,
    message:
      `Beat "${origin.beatId}", element "${key}"${where}: "${line.text}" is ${px(width)} wide, ` +
      `but it has ${px(line.room)} at its placed size; it would be cut off. Shorten it.`,
  };
}

type Declaration = {
  sceneIndex: number;
  beatId: string;
  elementIndex?: number;
  patternIndex?: number;
};

/** The chain scene that declares an element (or the pattern instance it belongs to). */
function declaration(spec: RenderableVideoSpec, chain: ChainLayout, key: string): Declaration {
  const instance = key.includes('/') ? key.slice(0, key.indexOf('/')) : undefined;
  for (let i = chain.sceneIndex; i < chain.sceneIndex + chain.beatIds.length; i += 1) {
    const scene = spec.scenes[i];
    if (!scene) continue;
    const elementIndex = scene.elements.findIndex((e) => e.id === key);
    if (elementIndex >= 0) return { sceneIndex: i, beatId: scene.beatId, elementIndex };
    const patternIndex = instance ? scene.patterns.findIndex((p) => p.id === instance) : -1;
    if (patternIndex >= 0) return { sceneIndex: i, beatId: scene.beatId, patternIndex };
  }
  return { sceneIndex: chain.sceneIndex, beatId: chain.beatIds[0] ?? '' };
}

function worldByKey(items: readonly WorldItem[]): Map<string, WorldItem> {
  const map = new Map<string, WorldItem>();
  const visit = (item: WorldItem) => {
    map.set(item.key, item);
    if (item.kind === 'primitive') item.children.forEach(visit);
  };
  items.forEach(visit);
  return map;
}

function flattenPlaced(items: readonly PlacedItem[]): PlacedItem[] {
  return items.flatMap((item) => [item, ...flattenPlaced(item.children ?? [])]);
}

function px(value: number): string {
  return `${Math.round(value)} px`;
}
