import type { RenderableVideoSpec, VideoFormat } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  allFixtureSpecs,
  fixtureChannelHandle,
  fixtureSeries,
  goldenFixtures,
  goldenRateLimiterSpec,
  goldenStrawberrySpec,
  withFormat,
} from '../../fixtures/index.ts';
import { TEXT_TRUNCATED } from '../layout/text-fit.ts';
import { getTheme, listThemes } from '../theme/index.ts';
import { hudLayout } from './hud-layout.ts';
import { barSlots, storyClockWidth, titleBlockSlots, type HudContext } from './hud-slots.ts';
import { titleBlockLayout } from './title-block.ts';
import { hudTextWarnings } from './hud-text-checks.ts';

const paper = getTheme('drafting-paper');
const dark = getTheme('blueprint-dark');
const FORMATS: VideoFormat[] = ['full', 'card'];

function contextFor(spec: RenderableVideoSpec): HudContext {
  const series =
    goldenFixtures.find((f) => f.spec.meta.id === spec.meta.id)?.series ?? fixtureSeries;
  return { seriesLabel: series.label, channelHandle: fixtureChannelHandle };
}

function paths(spec: RenderableVideoSpec, theme = paper, context = contextFor(spec)) {
  return hudTextWarnings(spec, theme, context).map((w) => {
    expect(w.code).toBe(TEXT_TRUNCATED);
    return w.path;
  });
}

function withChapter(
  spec: RenderableVideoSpec,
  id: string,
  change: { title?: string; question?: string },
): RenderableVideoSpec {
  const chapters = spec.story.chapters.map((c) => (c.id === id ? { ...c, ...change } : c));
  return { ...spec, story: { ...spec.story, chapters } };
}

const LONG = 'What happens when every single server keeps its own private count?';

describe('hudTextWarnings', () => {
  it('warns at an over-long chapter question (the chapter header)', () => {
    const spec = withChapter(goldenRateLimiterSpec, 'fleet', { question: LONG });
    expect(paths(spec)).toEqual(['$.story.chapters[4].question']);
    expect(hudTextWarnings(spec, paper, contextFor(spec))[0]?.message).toMatch(
      /^Chapter "fleet": the chapter header "— 5 · What happens.*" is \d+ px wide, but its slot has \d+ px \(about \d+ characters\)/,
    );
  });

  it('warns at an over-long title in the strip and in the card header', () => {
    const spec = { ...goldenRateLimiterSpec, meta: { ...goldenRateLimiterSpec.meta, title: LONG } };
    expect(paths(spec)).toEqual(['$.meta.title']);
    const card = withFormat(spec, 'card');
    const titled = {
      ...card,
      meta: { ...card.meta, title: `${LONG} ${LONG}` },
    };
    expect(paths(titled)).toEqual(['$.meta.title']);
    expect(hudTextWarnings(titled, paper, contextFor(card))[0]?.message).toMatch(
      /^The card header title .* needs \d lines of \d+ px \(about \d+ characters\), but the HUD shows 2/,
    );
  });

  it('counts the series label in the subject line (run context)', () => {
    const context = { seriesLabel: 'X'.repeat(40), channelHandle: null };
    expect(paths(goldenRateLimiterSpec, paper, context)).toEqual(['$.meta.title']);
  });

  it('warns at a headline that needs more than two lines', () => {
    const script = goldenRateLimiterSpec.script.map((s, i) =>
      i === 0 && s.headline ? { ...s, headline: { ...s.headline, text: `${LONG} ${LONG}` } } : s,
    );
    expect(paths({ ...goldenRateLimiterSpec, script })).toEqual(['$.script[0].headline.text']);
  });

  it('warns at an over-long chapter title as the step name, in both HUD styles', () => {
    const spec = withChapter(goldenStrawberrySpec, 'tokens', { title: LONG });
    expect(paths(spec, dark)).toEqual(['$.story.chapters[1].title']);
    expect(paths(spec, paper)).toEqual(['$.story.chapters[1].title']);
    expect(hudTextWarnings(spec, paper, contextFor(spec))[0]?.message).toMatch(
      /^Chapter "tokens": the step name ".*" is \d+ px wide, but its slot has \d+ px \(about \d+ characters\)/,
    );
  });

  it('gives the step name its row whatever the hero metric (only the clock shares it)', () => {
    const spec = goldenStrawberrySpec;
    const context = contextFor(spec);
    const metric = { label: 'A very long metric label', value: '1,00,000 tokens per second' };
    const withMetric = { ...spec, story: { ...spec.story, heroMetric: metric } };
    expect(barSlots(dark, withMetric, context).chapter).toBe(hudLayout(dark).chapterRow.width);
    expect(titleBlockSlots(paper, 'strip', withMetric).stepName).toBe(
      titleBlockLayout(paper, 'strip').clockRow.width,
    );
  });

  it('warns at an over-long chapter title in the card viewport label', () => {
    const spec = withChapter(withFormat(goldenRateLimiterSpec, 'card'), 'count', { title: LONG });
    expect(paths(spec)).toEqual(['$.story.chapters[1].title']);
    expect(hudTextWarnings(spec, paper, contextFor(spec))[0]?.message).toMatch(
      /^Chapter "count": the card viewport label/,
    );
  });
});

describe('barSlots', () => {
  it('gives the chapter header the row less the story clock at its widest', () => {
    const spec = goldenRateLimiterSpec;
    const context = contextFor(spec);
    const row = hudLayout(dark).chapterRow.width;
    expect(barSlots(dark, spec, context).chapter).toBe(row);
    const clock = { from: 'Spike', to: 'Stable', startValue: 0, endValue: 600, keyframes: [] };
    const story = { ...spec.story, heroMetric: { label: 'Rate', value: '100', storyClock: clock } };
    const withClock = barSlots(dark, { ...spec, story }, context).chapter;
    expect(withClock).toBeCloseTo(row - storyClockWidth(dark, clock) - dark.space.md);
  });
});

describe.each(FORMATS)('every fixture, %s format', (format) => {
  it.each(
    listThemes().flatMap((t) =>
      allFixtureSpecs.map((s) => [`${t.id} ${s.meta.id}`, t, s] as const),
    ),
  )('%s cuts no HUD text off', (_name, theme, spec) => {
    expect(hudTextWarnings(withFormat(spec, format), theme, contextFor(spec))).toEqual([]);
  });
});
