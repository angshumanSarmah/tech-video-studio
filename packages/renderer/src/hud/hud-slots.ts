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

/** `hud.style: 'bar'` (full format). */
export type BarSlots = {
  /** "SERIES · TOPIC" beside the handle. */
  topic: number;
  /** "STEP n/N · NAME" beside the dots and the pill. */
  stepText: number;
  /** "— n · QUESTION" beside the story clock. */
  chapter: number;
  /** Headline line width (two lines). */
  headline: number;
};

/** `hud.style: 'title-block'` (`strip`, full format) and the card format's `header`. */
export type TitleBlockSlots = {
  /** The strip's top cell: "SERIES · TOPIC". */
  subject: number;
  /** The header's title cell, per line (`TITLE_LINES` lines). */
  title: number;
  /** The chapter header or step name beside the hero metric dimension. */
  metaText: number;
  /** The card viewport's label cell. */
  viewportLabel: number;
  /** Headline line width (two lines). */
  headline: number;
};

export function barSlots(theme: Theme, spec: RenderableVideoSpec, ctx: HudContext): BarSlots {
  const { space } = theme;
  const layout = hudLayout(theme);
  const parts = visibleHudParts(spec);
  const metric = parts.heroMetric ? spec.story.heroMetric : undefined;
  const clock = parts.storyClock ? spec.story.heroMetric?.storyClock : undefined;
  const handle = ctx.channelHandle ? handleWidth(theme, ctx.channelHandle) + space.md : 0;
  const pill = metric ? pillWidth(theme, metric) + space.md : 0;
  const dots = stepDotsWidth(theme, shownChapterCount(spec)) + space.sm;
  return {
    topic: layout.topBar.width - handle,
    stepText: layout.metaRow.width - pill - dots,
    chapter: layout.chapterRow.width - (clock ? storyClockWidth(theme, clock) + space.md : 0),
    headline: layout.headline.width,
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
  const parts = visibleHudParts(spec);
  const metric = parts.heroMetric ? spec.story.heroMetric : undefined;
  const cell = layout.block.width - 2 * stroke.thin - 2 * space.sm;
  const viewport = areas.viewport?.width ?? 0;
  return {
    subject: cell,
    title: cell,
    metaText: layout.metaRow.width - (metric ? dimensionWidth(theme, metric) + space.md : 0),
    viewportLabel: viewport / 2 - 2 * space.sm - stroke.thin,
    headline: areas.headlineBand.width,
  };
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

/** The step tracker line. */
export function stepTrackerText(chapter: Pick<ChapterSpan, 'index' | 'title'>, count: number) {
  return `${stepLabel(chapter.index, count)} · ${chapter.title}`;
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

/** The pill: its text, padding and border. */
function pillWidth(theme: Theme, metric: HeroMetric): number {
  return textWidth(theme, 'hud', pillText(metric)) + 2 * theme.space.md + 2 * theme.stroke.thin;
}

function stepDotsWidth(theme: Theme, count: number): number {
  return count * STEP_DOT + Math.max(0, count - 1) * theme.space.xs;
}

/**
 * The story clock at its widest: the clock only runs between its points (start, keyframes, end),
 * so its longest reading is the largest of them.
 */
export function storyClockWidth(theme: Theme, clock: StoryClock): number {
  const widest = Math.max(clock.startValue, clock.endValue, ...clock.keyframes.map((k) => k.value));
  return textWidth(theme, 'hud', storyClockText(clock, formatClock(widest)));
}

/** "LABEL ├── VALUE ──┤": label, gap, two ticks, two extension lines, the padded value. */
function dimensionWidth(theme: Theme, metric: HeroMetric): number {
  const { space, stroke } = theme;
  const label = textWidth(theme, 'hud', metric.label);
  const value = textWidth(theme, 'hud', metric.value) + 2 * space.xs;
  return label + space.sm + 2 * stroke.thin + 2 * space.lg + value;
}
