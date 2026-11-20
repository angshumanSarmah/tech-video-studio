import type { RenderPreset } from '@explainer-studio/shared';

export type RenderMode = 'draft' | 'final';

/** What Remotion encodes: always H.264 yuv420p; drafts trade size and quality for speed. */
export type VideoEncoding = {
  codec: 'h264';
  pixelFormat: 'yuv420p';
  crf: number;
  x264Preset: 'veryfast' | 'medium';
};

const ENCODINGS: Record<RenderMode, VideoEncoding> = {
  draft: { codec: 'h264', pixelFormat: 'yuv420p', crf: 28, x264Preset: 'veryfast' },
  final: { codec: 'h264', pixelFormat: 'yuv420p', crf: 18, x264Preset: 'medium' },
};

export function encodingFor(mode: RenderMode): VideoEncoding {
  return ENCODINGS[mode];
}

export type Canvas = { width: number; height: number };

/**
 * Remotion's `scale` for a preset: compositions are laid out at the theme's canvas (1080×1920)
 * and scaled on output. Throws when the preset's aspect ratio differs from the canvas (it would
 * stretch) or when scaling would not land on the preset's exact size.
 */
export function presetScale(preset: RenderPreset, canvas: Canvas): number {
  const scale = preset.width / canvas.width;
  if (Math.round(canvas.height * scale) !== preset.height) {
    throw new Error(
      `Render preset ${preset.width}x${preset.height} does not match the ` +
        `${canvas.width}x${canvas.height} canvas aspect ratio.`,
    );
  }
  return scale;
}
