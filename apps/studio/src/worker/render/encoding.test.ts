import { SettingsSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { encodingFor, presetScale } from './encoding.ts';

const canvas = { width: 1080, height: 1920 };
const { presets } = SettingsSchema.parse({}).render;

describe('presets', () => {
  it('default to draft 540x960 @ 15 and final 1080x1920 @ 30', () => {
    expect(presets.draft).toEqual({ width: 540, height: 960, fps: 15 });
    expect(presets.final).toEqual({ width: 1080, height: 1920, fps: 30 });
  });
});

describe('presetScale', () => {
  it('scales the 1080x1920 canvas to the preset', () => {
    expect(presetScale(presets.draft, canvas)).toBe(0.5);
    expect(presetScale(presets.final, canvas)).toBe(1);
  });

  it('refuses a preset that would stretch the canvas', () => {
    expect(() => presetScale({ width: 1080, height: 1080, fps: 30 }, canvas)).toThrow(
      /does not match the 1080x1920 canvas/,
    );
  });
});

describe('encodingFor', () => {
  it('is always H.264 yuv420p; the final is higher quality than drafts', () => {
    const draft = encodingFor('draft');
    const final = encodingFor('final');
    for (const e of [draft, final])
      expect(e).toMatchObject({ codec: 'h264', pixelFormat: 'yuv420p' });
    expect(final.crf).toBeLessThan(draft.crf);
  });
});
