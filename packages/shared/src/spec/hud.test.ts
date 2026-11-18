import { describe, expect, it } from 'vitest';
import { HudSchema, resolveHud, type AutoToggle } from './hud.ts';

const hud = (overrides: Record<string, AutoToggle> = {}) => HudSchema.parse(overrides);
const chapterDisplay = (devices: string[], overrides?: Record<string, AutoToggle>) => {
  const { chapterHeader, stepTracker } = resolveHud(hud(overrides), devices);
  return { chapterHeader, stepTracker };
};

describe('HudSchema', () => {
  it('defaults chapter header and step tracker to auto, the rest to on', () => {
    expect(hud()).toEqual({
      topBar: true,
      chapterHeader: 'auto',
      stepTracker: 'auto',
      heroMetric: true,
      storyClock: true,
      headline: true,
    });
  });

  it('accepts auto only for the chapter display parts', () => {
    expect(HudSchema.safeParse({ topBar: 'auto' }).success).toBe(false);
    expect(HudSchema.safeParse({ stepTracker: 'sometimes' }).success).toBe(false);
  });
});

describe('resolveHud', () => {
  it('shows only the chapter header for question-driven chapters', () => {
    expect(chapterDisplay(['question_chapters', 'planted_question'])).toEqual({
      chapterHeader: true,
      stepTracker: false,
    });
  });

  it('shows only the step tracker for a roadmap', () => {
    expect(chapterDisplay(['roadmap'])).toEqual({ chapterHeader: false, stepTracker: true });
  });

  it('shows only the step tracker for any other story, including no devices', () => {
    for (const devices of [['failure_before_fix'], []]) {
      expect(chapterDisplay(devices)).toEqual({ chapterHeader: false, stepTracker: true });
    }
  });

  it('lets question-driven chapters win when a roadmap is also used', () => {
    expect(chapterDisplay(['roadmap', 'question_chapters'])).toEqual({
      chapterHeader: true,
      stepTracker: false,
    });
  });

  it('lets explicit true/false override auto', () => {
    expect(chapterDisplay(['roadmap'], { chapterHeader: true })).toEqual({
      chapterHeader: true,
      stepTracker: true,
    });
    expect(chapterDisplay(['question_chapters'], { chapterHeader: false })).toEqual({
      chapterHeader: false,
      stepTracker: false,
    });
    expect(chapterDisplay(['question_chapters'], { stepTracker: true })).toEqual({
      chapterHeader: true,
      stepTracker: true,
    });
  });

  it('passes the plain toggles through', () => {
    const resolved = resolveHud(hud({ storyClock: false }), []);
    expect(resolved).toMatchObject({ topBar: true, storyClock: false, headline: true });
  });
});
