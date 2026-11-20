import type { TimedWord } from '@explainer-studio/shared';

export interface SynthesizeOptions {
  /** Aborting kills the TTS process (it restarts on the next call) and rejects with the reason. */
  readonly signal?: AbortSignal;
}

export interface TtsResult {
  /** Absolute path of the WAV (24 kHz mono PCM). Owned by the cache: copy it, never edit it. */
  readonly wavPath: string;
  /**
   * One entry per `narrationWords(text)` word, in order, `text` in that normalized form. Times are
   * seconds from the start of `wavPath`.
   */
  readonly words: TimedWord[];
  readonly durationSec: number;
  /** True when the result came from the cache without running the TTS engine. */
  readonly cached: boolean;
}

/** Text to speech with word timings. One call per beat. */
export interface TtsProvider {
  synthesize(
    text: string,
    voice: string,
    speed: number,
    options?: SynthesizeOptions,
  ): Promise<TtsResult>;
  /** Stops any engine process the provider started. */
  close(): Promise<void>;
}

/** A synthesis whose word timings cannot be trusted (e.g. a word was not spoken). Not retried. */
export class TtsWordError extends Error {
  override readonly name = 'TtsWordError';
  constructor(readonly problems: readonly string[]) {
    super(`TTS word timings failed:\n- ${problems.join('\n- ')}`);
  }
}
