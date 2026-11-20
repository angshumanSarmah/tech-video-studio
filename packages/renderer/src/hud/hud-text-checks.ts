import {
  effectiveTiming,
  toJsonPath,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { describeRoom, fitsLine, textWidth, wrapText } from '../fonts/measure-text.ts';
import { TEXT_TRUNCATED } from '../layout/text-fit.ts';
import type { TextStyleName, Theme } from '../theme/index.ts';
import { beatFrameSpans } from '../timing/frames.ts';
import { chapterSpans, visibleHudParts, type ChapterSpan } from './hud-state.ts';
import {
  barSlots,
  chapterHeaderText,
  HEADLINE_LINES,
  subjectText,
  titleBlockSlots,
  type HudContext,
} from './hud-slots.ts';
import { TITLE_LINES, viewportLabel } from './title-block.ts';

/**
 * `text_truncated` for HUD text: every line the HUD would cut off (ellipsis or line clamp) in the
 * spec's format and the theme's HUD style, measured with `textWidth` against the same slot
 * widths the components cap their text at (`hud-slots.ts`). The run context is required: the
 * subject line holds the series label, and the handle shares the bar style's top bar. Pure.
 */

type HudStyle = 'bar' | 'strip' | 'header';

/** Any fps works: only which chapters have beats matters. */
const SPAN_FPS = 30;

export function hudTextWarnings(
  spec: RenderableVideoSpec,
  theme: Theme,
  context: HudContext,
): SpecError[] {
  const style = hudStyle(spec, theme);
  const chapters = chapterSpans(spec, beatFrameSpans(effectiveTiming(spec), SPAN_FPS));
  const checks =
    style === 'bar'
      ? barChecks(spec, theme, context, chapters)
      : titleBlockChecks(spec, theme, context, chapters, style);
  return [...checks, ...headlineChecks(spec, theme, headlineWidth(spec, theme, context, style))];
}

function hudStyle(spec: RenderableVideoSpec, theme: Theme): HudStyle {
  if (spec.meta.format === 'card') return 'header';
  return theme.hud.style === 'title-block' ? 'strip' : 'bar';
}

function headlineWidth(
  spec: RenderableVideoSpec,
  theme: Theme,
  context: HudContext,
  style: HudStyle,
): number {
  return style === 'bar'
    ? barSlots(theme, spec, context).headline
    : titleBlockSlots(theme, style, spec).headline;
}

function barChecks(
  spec: RenderableVideoSpec,
  theme: Theme,
  context: HudContext,
  chapters: readonly ChapterSpan[],
): SpecError[] {
  const parts = visibleHudParts(spec);
  const slots = barSlots(theme, spec, context);
  return [
    ...(parts.topBar ? subjectCheck(spec, theme, context, slots.topic, 'top bar') : []),
    ...(parts.chapterHeader
      ? chapterHeaderChecks(theme, chapters, slots.chapter)
      : parts.stepTracker
        ? stepNameChecks(theme, chapters, slots.chapter)
        : []),
  ];
}

function titleBlockChecks(
  spec: RenderableVideoSpec,
  theme: Theme,
  context: HudContext,
  chapters: readonly ChapterSpan[],
  variant: 'strip' | 'header',
): SpecError[] {
  const parts = visibleHudParts(spec);
  const slots = titleBlockSlots(theme, variant, spec);
  const top =
    variant === 'header'
      ? titleCheck(spec, theme, slots.title)
      : parts.topBar
        ? subjectCheck(spec, theme, context, slots.subject, 'title block')
        : [];
  const meta = parts.chapterHeader
    ? chapterHeaderChecks(theme, chapters, slots.metaText)
    : parts.stepTracker
      ? stepNameChecks(theme, chapters, slots.stepName)
      : [];
  const viewport =
    variant === 'header' && parts.chapterHeader
      ? chapters.flatMap((c) =>
          lineCheck(
            theme,
            'hud',
            viewportLabel({ chapterHeader: true, chapterTitle: c.title }),
            slots.viewportLabel,
            {
              path: chapterPath(c, 'title'),
              what: `Chapter "${c.chapterId}": the card viewport label`,
            },
          ),
        )
      : [];
  return [...top, ...meta, ...viewport];
}

function subjectCheck(
  spec: RenderableVideoSpec,
  theme: Theme,
  context: HudContext,
  room: number,
  where: string,
): SpecError[] {
  return lineCheck(theme, 'hud', subjectText(context.seriesLabel, spec.meta.title), room, {
    path: toJsonPath(['meta', 'title']),
    what: `The ${where}'s subject line`,
  });
}

/** The current step's name, on its own row (the chapter header is off). */
function stepNameChecks(theme: Theme, chapters: readonly ChapterSpan[], room: number): SpecError[] {
  return chapters.flatMap((c) =>
    lineCheck(theme, 'hud', c.title, room, {
      path: chapterPath(c, 'title'),
      what: `Chapter "${c.chapterId}": the step name`,
    }),
  );
}

function chapterHeaderChecks(
  theme: Theme,
  chapters: readonly ChapterSpan[],
  room: number,
): SpecError[] {
  return chapters.flatMap((c) =>
    lineCheck(theme, 'chapter', chapterHeaderText(c), room, {
      path: chapterPath(c, c.heading === c.title ? 'title' : 'question'),
      what: `Chapter "${c.chapterId}": the chapter header`,
    }),
  );
}

/** The card header's title: at most `TITLE_LINES` lines in the title style. */
function titleCheck(spec: RenderableVideoSpec, theme: Theme, width: number): SpecError[] {
  return blockCheck(theme, 'title', spec.meta.title, width, TITLE_LINES, {
    path: toJsonPath(['meta', 'title']),
    what: 'The card header title',
  });
}

function headlineChecks(spec: RenderableVideoSpec, theme: Theme, width: number): SpecError[] {
  if (!visibleHudParts(spec).headline) return [];
  return spec.script.flatMap((beat, i) =>
    beat.headline
      ? blockCheck(theme, 'headline', beat.headline.text, width, HEADLINE_LINES, {
          path: toJsonPath(['script', i, 'headline', 'text']),
          what: `Beat "${beat.beatId}": the headline`,
        })
      : [],
  );
}

type Target = { path: string; what: string };

function lineCheck(
  theme: Theme,
  style: TextStyleName,
  text: string,
  room: number,
  target: Target,
): SpecError[] {
  if (fitsLine(theme, style, text, room)) return [];
  const width = textWidth(theme, style, text);
  return [
    truncated(
      target,
      `"${text}" is ${px(width)} wide, but its slot has ${describeRoom(theme, style, room)}; ` +
        'it would be cut off.',
    ),
  ];
}

function blockCheck(
  theme: Theme,
  style: TextStyleName,
  text: string,
  width: number,
  maxLines: number,
  target: Target,
): SpecError[] {
  const wrapped = wrapText(theme, style, text, width);
  if (wrapped.lines <= maxLines && !wrapped.overflows) return [];
  const line = describeRoom(theme, style, width);
  const why = wrapped.overflows
    ? `has a word wider than its ${line} line`
    : `needs ${wrapped.lines} lines of ${line}, but the HUD shows ${maxLines}`;
  return [truncated(target, `"${text}" ${why}; it would be cut off.`)];
}

function truncated(target: Target, detail: string): SpecError {
  return {
    path: target.path,
    code: TEXT_TRUNCATED,
    message: `${target.what} ${detail} Shorten it.`,
  };
}

function chapterPath(chapter: ChapterSpan, field: 'title' | 'question'): string {
  return toJsonPath(['story', 'chapters', chapter.index, field]);
}

function px(value: number): string {
  return `${Math.round(value)} px`;
}
