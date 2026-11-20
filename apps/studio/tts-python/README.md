# Kokoro TTS env

The Python side of the TTS provider (`apps/studio/src/worker/tts`): Kokoro-82M behind a small
JSON-lines server (`kokoro_server.py`) that the Node worker starts once and reuses.

```sh
pnpm tts:setup    # uv sync --frozen + pinned model files (needs uv; installs nothing global)
pnpm tts:doctor   # env, model checksums, espeak-ng fallback, test synthesis, real-time factor
```

- **Pinned.** Packages are exact in `uv.lock` (resolved with `exclude-newer`); Python 3.12 is a
  uv-managed interpreter in `.uv-python/` (kokoro needs < 3.13). Model weights and voices come
  from `hexgrad/Kokoro-82M` at the revision in `models.lock.json`, checked by sha256. To add a
  voice: add `voices/<id>.pt` with an empty hash, run `uv run python fetch_models.py
--write-lock`, review the hash and commit.
- **Offline at runtime.** The server loads only `models/` and forces the Hugging Face hub
  offline. It runs on CPU (deterministic, and faster than real time for an 82M model).
- **Word timestamps come from Kokoro itself.** For English voices (`a*` US, `b*` UK), kokoro
  0.9.4's `KPipeline` sets `start_ts` / `end_ts` on every misaki token from the duration predictor,
  the same durations that size the audio, so no forced aligner is needed. Times are relative to
  each chunk Kokoro splits the text into; the server offsets them onto the whole WAV. Non-English
  voices have no timestamps and are refused. The Node side pulls word edges in to audible speech where
  Kokoro gives a pause to the word before it (`speech-trim.ts`).
- **espeak-ng** reads words missing from misaki's dictionary. It is the `libespeak-ng` bundled by
  the pinned `espeakng-loader` wheel (in `.venv`), not a system install. Kokoro silently drops
  such words when espeak-ng fails to load, so the server refuses to start without it, and the
  Node side fails any synthesis where a narration word maps to no spoken token.
