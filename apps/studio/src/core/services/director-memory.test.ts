import type { UsageKind } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '../db/repositories/exports.ts';
import { createRun, setActiveRunStatus, type Run } from '../db/repositories/runs.ts';
import { listSeries } from '../db/repositories/series.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { memoryRules } from '../db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { directorMemory, nextSeriesNumber, RECENT_VIDEOS, recentUsage } from './director-memory.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const seriesIds = () => listSeries(t.db).map((s) => s.id);

type Usage = [UsageKind, string][];

/** Exports a run with its usage (a pipeline video; no usage: a scratch render run). */
function exportRun(run: Run, title: string, usage: Usage | null = [['topic_class', 'concept']]) {
  recordExport(t.db, {
    runId: run.id,
    mp4Path: `exports/${run.id}/v.mp4`,
    srtPath: `exports/${run.id}/v.srt`,
    durationMs: 60_000,
    title,
    ...(usage ? { usage: usage.map(([kind, value]) => ({ kind, value })) } : {}),
  });
  setActiveRunStatus(t.db, run.id, 'done');
}

/** A run of a new topic in the first series, exported with `usage` unless `exported` is false. */
function video(
  title: string,
  options: { exported?: boolean; seriesId?: number; usage?: Usage | null } = {},
) {
  const topic = createTopic(t.db, { title, notes: `<${title} notes>` });
  const run = createRun(t.db, {
    app: TEST_APP_SETTINGS,
    topicId: topic.id,
    seriesId: options.seriesId ?? seriesIds()[0]!,
  });
  if (options.exported ?? true) exportRun(run, title, options.usage);
  return run;
}

/** A multi-part video: the parent and its parts, each part exported with its own usage. */
function multiPart(title: string, partUsage: Usage[]) {
  const parent = video(title, { exported: false });
  const parts = partUsage.map((usage, i) => {
    const part = createRun(t.db, {
      app: TEST_APP_SETTINGS,
      topicId: parent.topicId,
      seriesId: parent.seriesId,
      part: { parentRunId: parent.id, index: i + 1, count: partUsage.length },
    });
    exportRun(part, `${title} (part ${i + 1})`, usage);
    return part;
  });
  setActiveRunStatus(t.db, parent.id, 'done');
  return { parent, parts };
}

describe('directorMemory', () => {
  it('is empty without history', () => {
    const run = video('<current>', { exported: false });
    expect(directorMemory(t.db, run.id)).toEqual({
      styleRules: [],
      recent: {
        videos: 0,
        devices: [],
        layouts: [],
        patterns: [],
        combos: [],
        structures: [],
      },
      pastTopics: [],
      similarTopics: [],
    });
  });

  it(`reads usage from the last ${RECENT_VIDEOS} exported videos only, sorted`, () => {
    video('<oldest>', { usage: [['device_layout', 'roadmap/pipeline']] });
    // Every exported video records some usage (its topic class at least).
    const plain: Usage = [['topic_class', 'concept']];
    Array.from({ length: RECENT_VIDEOS }, (_, i) =>
      video(`<topic-${i}>`, {
        usage: [
          [['device', 'what_breaks']],
          plain,
          [['layout', 'pipeline']],
          plain,
          [
            ['device', 'failure_before_fix'],
            ['device_layout', 'failure_before_fix/versus_split'],
          ],
        ][i] as Usage,
      }),
    );
    video('<unexported>', { exported: false });
    const current = video('<current>', { exported: false });

    const memory = directorMemory(t.db, current.id);
    expect(memory.recent).toMatchObject({
      videos: RECENT_VIDEOS,
      devices: ['failure_before_fix', 'what_breaks'],
      layouts: ['pipeline'],
      patterns: [],
      combos: ['failure_before_fix/versus_split'],
    });
    expect(memory.recent.structures?.map((s) => s.title)).toEqual([
      '<topic-4>',
      '<topic-3>',
      '<topic-2>',
      '<topic-1>',
      '<topic-0>',
    ]);
    expect(memory.pastTopics.map((p) => p.title)).toEqual([
      '<topic-4>',
      '<topic-3>',
      '<topic-2>',
      '<topic-1>',
      '<topic-0>',
      '<oldest>',
    ]);
    expect(memory.pastTopics[0]?.notes).toBe('<<topic-4> notes>');
  });

  it('gives each recent video its hooks and main pattern sequences, newest first', () => {
    video('<a>', {
      usage: [
        ['hook', 'problem/what_breaks'],
        ['pattern_sequence', 'p1>p2'],
      ],
    });
    video('<b>', { usage: [['hook', 'puzzle/planted_question']] });
    const current = video('<current>', { exported: false });
    expect(recentUsage(t.db, current.id).structures).toEqual([
      { title: '<b>', hooks: ['puzzle/planted_question'], sequences: [] },
      { title: '<a>', hooks: ['problem/what_breaks'], sequences: ['p1>p2'] },
    ]);
  });

  it('counts a multi-part video once, with every part’s hooks', () => {
    multiPart('<series of three>', [
      [['hook', 'problem/a']],
      [['hook', 'problem/b']],
      [['hook', 'problem/c']],
    ]);
    const others = Array.from({ length: RECENT_VIDEOS - 1 }, (_, i) => video(`<topic-${i}>`));
    const current = video('<current>', { exported: false });
    const { videos, structures } = recentUsage(t.db, current.id);
    expect(videos).toBe(RECENT_VIDEOS);
    expect(structures.at(-1)).toEqual({
      title: '<series of three> (part 3)',
      hooks: ['problem/a', 'problem/b', 'problem/c'],
      sequences: [],
    });
    expect(others).toHaveLength(RECENT_VIDEOS - 1);
    // One topic for the three parts.
    expect(directorMemory(t.db, current.id).pastTopics.map((p) => p.title)).toContain(
      '<series of three>',
    );
  });

  it('leaves out the run’s own video: a part never sees its earlier parts as recent', () => {
    const { parent, parts } = multiPart('<two parts>', [[['pattern', 'p1']], []]);
    video('<other>', { usage: [['pattern', 'p2']] });
    expect(recentUsage(t.db, parts[1]!.id)).toMatchObject({ videos: 1, patterns: ['p2'] });
    expect(recentUsage(t.db, parent.id)).toMatchObject({ videos: 1, patterns: ['p2'] });
  });

  it('is not a video without usage: a scratch render run’s export is left out', () => {
    video('render: spec.json', { usage: null });
    const current = video('<current>', { exported: false });
    const memory = directorMemory(t.db, current.id);
    expect(memory.recent.videos).toBe(0);
    expect(memory.pastTopics).toEqual([]);
  });

  it('lists earlier topics close to this one', () => {
    video('Rate limiter');
    const current = video('Rate limiting', { exported: false });
    expect(directorMemory(t.db, current.id).similarTopics).toMatchObject([
      { title: 'Rate limiter', angle: '<Rate limiter notes>', score: 1 },
    ]);
  });

  it('includes only active rules scoped to the director or all agents', () => {
    const run = video('<current>', { exported: false });
    t.db
      .insert(memoryRules)
      .values([
        { scope: 'director', text: '<rule-director>', status: 'active' },
        { scope: 'generator', text: '<rule-generator>', status: 'active' },
        { scope: 'all', text: '<rule-all>', status: 'active' },
        { scope: 'director', text: '<rule-proposed>', status: 'proposed' },
      ])
      .run();
    expect(directorMemory(t.db, run.id).styleRules).toEqual(['<rule-director>', '<rule-all>']);
  });
});

describe('nextSeriesNumber', () => {
  it('counts exported videos in the series', () => {
    const [first, second] = seriesIds();
    expect(nextSeriesNumber(t.db, first!)).toBe(1);
    video('<a>');
    video('<b>');
    video('<c>', { exported: false });
    video('<d>', { seriesId: second! });
    expect(nextSeriesNumber(t.db, first!)).toBe(3);
    expect(nextSeriesNumber(t.db, second!)).toBe(2);
  });
});
