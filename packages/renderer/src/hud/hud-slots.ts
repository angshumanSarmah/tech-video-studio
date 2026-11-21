import type { HeroMetric, RenderableVideoSpec, StoryClock } from '@explainer-studio/shared';
import { textWidth } from '../fonts/measure-text.ts';
import { formatAreas } from '../layout/format.ts';
import type { Theme } from '../theme/index.ts';
import { hudLayout } from './hud-layout.ts';
import { formatClock, visibleHudParts, type ChapterSpan } from './hud-state.ts';
import { titleBlockLayout, type TitleBlockVariant } from './title-block.ts';

/**
 * Pure slot widths for HUD text that is cut off when too long (ellipsis or a two-line clamp).
 * Each is the row's width less the measured width of what shares the row (the pill, the
 * dimension, the story clock at its widest, the step dots, the handle). The components cap their
 * text at exactly these (`flex: none; maxWidth`), so flexbox never cuts it narrower, and
 * `hudTextWarnings` measures the same strings against the same widths. Canvas px.
 */

/** Run data the HUD shows that is not in the spec. */
export type HudContext = { seriesLabel: string; channelHandle: string | null };

/** Lines the headline is clamped to. */
export const HEADLINE_LINES = 2;

/** Side of a step tracker dot. */
export const STEP_DOT = 14;

/**
 * Something drawn beside a text on its row, and the px it takes from that text's slot (its width
 * plus the gap): what a `text_truncated` message names when a row is crowded.
 */
export type RowShare = { what: string; px: number };

/** `hud.style: 'bar'` (full format). */
export type BarSlots = {
  /** "SERIES · TOPIC" beside the handle. */
  topic: number;
  /**
   * The chapter row beside the story clock: "— n · QUESTION" (chapter header), or the current
   * step's name when the header is off (the step marker sits on the row above).
   */
  chapter: number;
  /** Headline line width (two lines). */
  headline: number;
  /** The hero metric pill's text ("LABEL · VALUE") beside the step marker. */
  metric: number;
  /** What shares each text's row (empty when nothing does). */
  shares: { topic: RowShare[]; chapter: RowShare[]; metric: RowShare[] };
};

/** `hud.style: 'title-block'` (`strip`, full format) and the card format's `header`. */
export type TitleBlockSlots = {
  /** The strip's top cell: "SERIES · TOPIC". */
  subject: number;
  /** The header's title cell, per line (`TITLE_LINES` lines). */
  title: number;
  /**
   * The chapter row beside the story clock: the chapter header, or the current step's name when
   * the header is off (the step dots and the hero metric sit on the row above).
   */
  chapter: number;
  /** The card viewport's label cell. */
  viewportLabel: number;
  /** Headline line width (two lines). */
  headline: number;
  /** The hero metric dimension's label and value together, beside the step dots. */
  metric: number;
  /** What shares each text's row (empty when nothing does). */
  shares: { chapter: RowShare[]; metric: RowShare[] };
};

export function barSlots(theme: Theme, spec: RenderableVideoSpec, ctx: HudContext): BarSlots {
  const layout = hudLayout(theme);
  const shares = {
    topic: handleShares(theme, ctx.channelHandle),
    chapter: clockShares(theme, spec),
    metric: markerShares(theme, spec, true),
  };
  return {
    topic: layout.topBar.width - used(shares.topic),
    chapter: layout.chapterRow.width - used(shares.chapter),
    headline: layout.headline.width,
    metric: layout.metaRow.width - used(shares.metric) - pillChrome(theme),
    shares,
  };
}

export function titleBlockSlots(
  theme: Theme,
  variant: TitleBlockVariant,
  spec: RenderableVideoSpec,
): TitleBlockSlots {
  const { space, stroke } = theme;
  const layout = titleBlockLayout(theme, variant);
  const areas = formatAreas(theme, spec.meta.format);
  const cell = titleCellWidth(theme, variant);
  const viewport = areas.viewport?.width ?? 0;
  const shares = { chapter: clockShares(theme, spec), metric: markerShares(theme, spec, false) };
  return {
    subject: cell,
    title: cell,
    chapter: layout.chapterRow.width - used(shares.chapter),
    viewportLabel: viewport / 2 - 2 * space.sm - stroke.thin,
    headline: areas.headlineBand.width,
    metric: layout.metaRow.width - used(shares.metric) - dimensionChrome(theme),
    shares,
  };
}

/** The title block's text cell: the subject line (strip) or the title (header), in px. */
export function titleCellWidth(theme: Theme, variant: TitleBlockVariant): number {
  const { space, stroke } = theme;
  return titleBlockLayout(theme, variant).block.width - 2 * stroke.thin - 2 * space.sm;
}

function used(shares: readonly RowShare[]): number {
  return shares.reduce((sum, share) => sum + share.px, 0);
}

/** The handle beside the top bar's subject line. */
function handleShares(theme: Theme, handle: string | null): RowShare[] {
  if (!handle) return [];
  return [
    { what: `the channel handle "${handle}"`, px: handleWidth(theme, handle) + theme.space.md },
  ];
}

/**
 * The step marker beside the hero metric: one dot per shown chapter, after "STEP n/N" at its
 * widest in the bar style (`label`). None while the step tracker is off.
 */
function markerShares(theme: Theme, spec: RenderableVideoSpec, label: boolean): RowShare[] {
  const count = shownChapterCount(spec);
  if (!visibleHudParts(spec).stepTracker || count === 0) return [];
  const { space } = theme;
  const dots = count * STEP_DOT + (count - 1) * space.xs;
  const widestLabel = Math.max(
    ...Array.from({ length: count }, (_, i) => textWidth(theme, 'hud', stepLabel(i, count))),
  );
  const marker = label ? widestLabel + space.sm + dots : dots;
  const what = label
    ? `the step marker ("${stepLabel(count - 1, count)}" and ${count} dots)`
    : `the step marker (${count} dots)`;
  return [{ what, px: marker + space.md }];
}

/** The hero metric pill less its text: horizontal padding and border. */
export function pillChrome(theme: Theme): number {
  return 2 * theme.space.md + 2 * theme.stroke.thin;
}

/** The story clock (at its widest reading) beside the chapter row's text. */
function clockShares(theme: Theme, spec: RenderableVideoSpec): RowShare[] {
  const clock = visibleHudParts(spec).storyClock ? spec.story.heroMetric?.storyClock : undefined;
  if (!clock) return [];
  return [
    {
      what: `the story clock "${storyClockText(clock, formatClock(widestClockValue(clock)))}" (story.heroMetric.storyClock)`,
      px: storyClockWidth(theme, clock) + theme.space.md,
    },
  ];
}

/** Chapters the HUD shows (those with beats; see `chapterSpans`): the N in "STEP n/N". */
export function shownChapterCount(spec: RenderableVideoSpec): number {
  const used = new Set(spec.story.beats.map((b) => b.chapterId));
  return spec.story.chapters.filter((c) => used.has(c.id)).length;
}

/** The top bar's and the strip's subject line. */
export function subjectText(seriesLabel: string, title: string): string {
  return `${seriesLabel} · ${title}`;
}

/** The chapter header line. */
export function chapterHeaderText(chapter: Pick<ChapterSpan, 'index' | 'heading'>): string {
  return `— ${chapter.index + 1} · ${chapter.heading}`;
}

/** "STEP n/N" (the step tracker's marked part). */
export function stepLabel(index: number, count: number): string {
  return `STEP ${index + 1}/${count}`;
}

/** The hero metric pill's text. */
export function pillText(metric: HeroMetric): string {
  return `${metric.label} · ${metric.value}`;
}

/** The story clock's text at a value. */
export function storyClockText(clock: Pick<StoryClock, 'from' | 'to'>, value: string): string {
  return `${clock.from} → ${clock.to} · ${value}`;
}

/** The handle is drawn as typed (no case transform). */
function handleWidth(theme: Theme, handle: string): number {
  return textWidth(theme, 'hud', handle, { uppercase: false });
}

/**
 * The story clock at its widest: the clock only runs between its points (start, keyframes, end),
 * so its longest reading is the largest of them.
 */
export function storyClockWidth(theme: Theme, clock: StoryClock): number {
  return textWidth(theme, 'hud', storyClockText(clock, formatClock(widestClockValue(clock))));
}

function widestClockValue(clock: StoryClock): number {
  return Math.max(clock.startValue, clock.endValue, ...clock.keyframes.map((k) => k.value));
}

/**
 * The hero metric dimension "LABEL ├── VALUE ──┤" less its text: the gap after the label, two
 * ticks, two extension lines and the value's padding. Its text (label and value) gets the rest.
 */
export function dimensionChrome(theme: Theme): number {
  const { space, stroke } = theme;
  return space.sm + 2 * stroke.thin + 2 * space.lg + 2 * space.xs;
}
