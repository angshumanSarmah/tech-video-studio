import type { RunSettings, TtsSettings } from '@explainer-studio/shared';

export interface TtsOptions {
  readonly voice: string;
  readonly speed: number;
}

/**
 * Voice and speed for a run's narration. Speed: the run's override, else the app setting (whose
 * schema default is 1.0). Pass `undefined` outside a run (scripts, voice tests).
 */
export function resolveTtsOptions(run: RunSettings | undefined, app: TtsSettings): TtsOptions {
  return { voice: app.voice, speed: run?.tts?.speed ?? app.speed };
}
