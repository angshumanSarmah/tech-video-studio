import {
  queryTerms,
  TOPIC_CLASS_CATALOGUE,
  type AssetFamily,
  type LibraryAsset,
  type VideoSpec,
} from '@explainer-studio/shared';
import { rankByWords } from '../assets/rank.ts';
import { SEED_REGISTRY, type AssetRegistry } from '../assets/library.ts';
import { specAssetUses } from './asset-uses.ts';
import type { Registries } from './registries.ts';

/**
 * The Generator's per-beat asset list (P1C.12): at most `MAX_BEAT_ASSETS` approved assets for
 * one beat, in its user message (the cached prefix only says how to read it). In order of
 * priority: the ids this video's earlier boards already use (so one thing keeps one icon), the
 * best `rankByWords` matches for the beat's key words (intent, new terms and their plain
 * meanings, headline, tags, stat card labels), then its narration's, then the video's title and
 * running example (at most two per id first word, so `book_*` variants do not crowd the list),
 * then core seed assets of the topic class's `assetFamilies`, in that order.
 * Deterministic and pure; the lines are sorted by family, then id (code units).
 */

export const MAX_BEAT_ASSETS = 60;
/** At most this many of the video's own ids are listed first. */
export const MAX_VIDEO_ASSETS = 15;
/** At most this many matches for the beat's and the video's words. */
export const MAX_BEAT_MATCHES = 35;
/** Tags shown per line (the library keeps up to 12). */
const TAGS_SHOWN = 6;
/** Matches sharing an id's first word (`book_*`, `move_*`): at most this many, best first. */
const MAX_PER_HEAD = 2;

export type BeatAsset = { readonly asset: LibraryAsset; readonly usedInVideo: boolean };

export interface BeatAssetOptions {
  /** More words about the beat that the spec does not hold (its new terms' plain meanings). */
  readonly extraText?: readonly string[];
}

export function beatAssets(
  spec: VideoSpec,
  beatIndex: number,
  registries: Registries,
  options: BeatAssetOptions = {},
): BeatAsset[] {
  const library = registries.assets;
  const chosen = new Map<string, BeatAsset>();
  const add = (asset: LibraryAsset | undefined, usedInVideo = false) => {
    if (asset && !chosen.has(asset.id) && chosen.size < MAX_BEAT_ASSETS) {
      chosen.set(asset.id, { asset, usedInVideo });
    }
  };
  for (const id of videoAssetIds(spec, beatIndex, registries).slice(0, MAX_VIDEO_ASSETS)) {
    add(library.get(id), true);
  }
  const matchLimit = chosen.size + MAX_BEAT_MATCHES;
  const perHead = new Map<string, number>();
  const [keyWords, narrationWords] = beatWords(spec, beatIndex, options);
  for (const words of [keyWords, narrationWords, videoWords(spec)]) {
    for (const { id } of rankByWords(words, library)) {
      if (chosen.size >= matchLimit) break;
      const head = id.split(/[_-]/)[0] ?? id;
      if (chosen.has(id) || (perHead.get(head) ?? 0) >= MAX_PER_HEAD) continue;
      perHead.set(head, (perHead.get(head) ?? 0) + 1);
      add(library.get(id));
    }
  }
  for (const asset of familyFill(spec, library)) add(asset);
  return [...chosen.values()].sort(
    (a, b) => byCodeUnits(a.asset.family, b.asset.family) || byCodeUnits(a.asset.id, b.asset.id),
  );
}

/** One line per asset: `- id (family): name; tags`, marked when the video already uses it. */
export function beatAssetLines(assets: readonly BeatAsset[]): string[] {
  return assets.map(({ asset, usedInVideo }) => {
    const tags = asset.tags.slice(0, TAGS_SHOWN).join(', ');
    const used = usedInVideo ? ' [used in this video]' : '';
    return `- ${asset.id} (${asset.family}): ${asset.name}; ${tags}${used}`;
  });
}

/** Approved ids the boards before this beat use, in first-use order. */
function videoAssetIds(spec: VideoSpec, beatIndex: number, registries: Registries): string[] {
  const earlier = new Set(spec.story.beats.slice(0, beatIndex).map((b) => b.id));
  const ids = specAssetUses(spec, registries)
    .filter((use) => earlier.has(use.beatId) && registries.assets.has(use.id))
    .map((use) => use.id);
  return [...new Set(ids)];
}

/**
 * The beat's words in two tiers: key words (intent, new terms and their meanings, headline, tags,
 * stat card labels), then the narration's, which name actions more than things ("check",
 * "move"), so they rank only after every key-word match.
 */
function beatWords(
  spec: VideoSpec,
  beatIndex: number,
  options: BeatAssetOptions,
): [string[], string[]] {
  const beat = spec.story.beats[beatIndex];
  const script = spec.script?.find((s) => s.beatId === beat?.id);
  const keyTexts = [
    beat?.intent,
    ...(beat?.newTerms ?? []),
    ...(options.extraText ?? []),
    script?.headline?.text,
    ...(script?.tags ?? []),
    ...(script?.statCards ?? []).map((c) => c.label),
  ];
  const words = (texts: readonly (string | undefined)[]) =>
    queryTerms(texts.filter((t): t is string => Boolean(t)).join(' '));
  return [words(keyTexts), words([script?.narration])];
}

function videoWords(spec: VideoSpec): string[] {
  return queryTerms([spec.meta.title, spec.story.runningExample ?? ''].join(' '));
}

/** Core seed assets of the topic class's families, family by family in its order. */
function familyFill(spec: VideoSpec, library: AssetRegistry): LibraryAsset[] {
  const entry = TOPIC_CLASS_CATALOGUE.entries.find((e) => e.id === spec.meta.topicClass);
  const families: readonly AssetFamily[] = entry?.assetFamilies ?? [];
  const core = [...SEED_REGISTRY.keys()].sort(byCodeUnits);
  return families.flatMap((family) =>
    core.flatMap((id) => {
      const asset = library.get(id);
      return asset?.family === family ? [asset] : [];
    }),
  );
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
