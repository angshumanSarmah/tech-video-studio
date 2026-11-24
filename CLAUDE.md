# Explainer Studio

## Product

A local, single-user app that generates YouTube Shorts (9:16, 45–90 s) explaining system design and
AI topics for engineers. One channel, two series (System Design, AI). Runs are started manually;
output is an MP4 + SRT that is uploaded by hand.

The LLM writes story and structure only. A fixed renderer, a growing library of primitives and
patterns, and a layout engine produce every pixel.

Full design and the build plan (prompt IDs such as P0.3 and P1A.3) live in
`Tech Explainer Studio Design and Claude Code Prompts.md`.

## Pipeline

```text
Topic + links -> Source ingestion
  -> Researcher    (cited fact notes)                          -> Gate 1: research
  -> Director      (topic class, devices, hero metric, beats)  -> Gate 2: beat sheet
  -> Scriptwriter  (narration, headlines, tags)
  -> TTS           (Kokoro, audio + word timestamps)
  -> Generator     (board scene JSON per beat)
  -> Curator       (validation, fact/quality review, auto-repair) -> Gate 3: scenes
  -> Draft render  (low-res, per beat)                         -> Gate 4: draft
  -> Final render  -> MP4 + SRT
```

- Every gate has an auto-approve checkbox per run; otherwise it waits for review in the UI.
- At any gate the user can edit (form or raw JSON) or regenerate a single beat with feedback.
- Agents, TTS and rendering run in the worker. Everything that touches pixels or audio is
  deterministic code.

## Repo layout

```text
apps/studio/            one Node app, three entrypoints
  src/server/           Hono HTTP API (thin handlers; enqueue work, never do it)
  src/worker/           job runner: agents, TTS, render (separate process)
  src/core/             Node-only code shared by server + worker (config, data dirs)
  src/web/              Vue 3 + Vite SPA (Vue Router, Pinia, Tailwind v4; see "Web app")
  drizzle/              generated SQL migrations (drizzle-kit)
  tts-python/           Kokoro-82M env (uv, pinned) and its JSON-lines server (see "TTS")
packages/shared/        Zod schemas, catalogues, inferred types (consumed as TS source)
packages/renderer/      Remotion compositions (React), the theme system and the asset library (see "Renderer")
data/                   runtime data: SQLite DB, runs/, topics/, assets/, exports/ (gitignored)
docs/TODO.md            follow-ups logged instead of done
```

Prerequisites: `nvm use` (Node 24, from `.nvmrc`), then `corepack enable pnpm` so `pnpm` resolves to
the version pinned in `packageManager`. Re-run it after switching Node versions; do not install pnpm
globally.

Commands (from the repo root): `pnpm dev` (server, worker and Vite via `concurrently`),
`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`. The visual regression
test is separate: `pnpm --filter @explainer-studio/studio test:visual` (see "Golden fixtures").
TTS: `pnpm tts:setup` (needs `uv`; installs nothing global) and `pnpm tts:doctor` (see "TTS").

Dev ports: the UI is on http://localhost:4310 (`WEB_PORT`, Vite, `strictPort`) and the API on 4311
(`PORT`, Hono). Vite proxies `/api` to `PORT`; its default comes from `EnvSchema`.

## Architecture rules

1. **No code per video.** Every video is a `VideoSpec` JSON. The renderer is generic and reads any
   spec. Code changes only when a primitive, pattern, layout or theme is added.
2. **The LLM never outputs coordinates or sizes.** It outputs logical content (beats, elements,
   patterns, labels, events, focus). The layout engine computes positions, sizes, focus and camera.
3. **Cross-package types are Zod schemas in `packages/shared`.** Infer TS types with `z.infer`;
   never hand-write a duplicate interface. Validate at every process and network boundary.
4. **Registries, not switch statements.** Primitives, patterns, layouts and themes are each
   registered with an id, a Zod props schema and an LLM-facing description. Adding one must not
   require edits anywhere else: catalogues, prompts and validation all read from the registry.
5. **Heavy work runs only in the worker.** LLM loops, TTS and rendering never run in a request
   handler. The server validates input, enqueues a job and returns. ESLint enforces the import
   boundaries between `server`, `worker`, `core` and `web`.
6. **One LLM client.** Every LLM call goes through a single client that logs the prompt, response,
   token counts (cached/uncached/output) and cost. No direct SDK calls elsewhere.
7. **Variety comes from many small composable primitives and patterns.** Never add a generic
   catch-all scene type (e.g. "nodes + arrows in a row") that topics fall back to. When nothing
   fits, record a missing-primitive request in the backlog; do not fall back to a generic scene.
8. **Every animation event is anchored to a narration word** via TTS word timestamps (word index or
   word + occurrence within the beat), or explicitly to a beat start or end plus an offset. Never
   anchor to a fraction of scene time.
9. **Keep process light.** No approval hash chains, audit trails, ADR registers or publishing
   integrations. UI review gates and cited research notes are enough.
10. **Agent prompt convention.** Every agent prompt follows the convention below.

### Agent prompt convention

- **Versioned templates per agent.** Each agent has its own template module with a version
  (e.g. `director@v3`), assembled from named sections. Never one giant string. The version is
  recorded with each LLM call.
- **Closed lists.** Every id the model may use (primitive, pattern, layout, device, action, asset)
  is injected from the registry and stated as exhaustive: "Use only these ids. There are no others."
- **Hard rules as short DO / DO NOT sections.** Short, imperative bullets, not prose.
- **Common mistakes.** A short list of 5–8 mistakes to avoid, specific to that agent.
- **Placeholder examples.** Example values are written as `<example-...>` placeholders so the
  model can't copy them verbatim.

```text
## ALLOWED PRIMITIVES (exhaustive: use only these ids)
- <id>: <one-line LLM-facing description>   # injected from the registry
## DO
- Anchor every event to a word in this beat's narration.
## DO NOT
- Output coordinates, sizes or colours.
## COMMON MISTAKES
- Inventing a primitive id that is not in the list above.
## OUTPUT SHAPE
{ "beatId": "<example-beat-id>", "elements": [{ "id": "<example-element-id>", "primitive": "<example-primitive-id>" }] }
```

## VideoSpec

- Schema and validation live in `packages/shared/src/spec`. Validate with `validateVideoSpec`
  (any stage) or `validateRenderableVideoSpec` (before rendering). Both return
  `{ ok, spec, errors, warnings }`; each issue is `{ path, code, message }` with a JSON path.
- `errors` make a spec invalid. `warnings` never do (e.g. `target_length_mismatch`).
- **Agent output:** warnings count as failures and trigger the repair loop, like errors.
- **User edits at gates:** a save succeeds when `ok` is true; the UI shows the warnings.
- A narration "word" is whatever `narrationWords()` returns. Word anchors and timed word lists
  both count words this way.
- **Length:** `meta.targetLengthSec`, a run's `lengthOverrideSec` and every `settings.video`
  length stay within `VIDEO_LENGTH_LIMITS_SEC` (15–170 s); a timed track past 170 s is the error
  `timing_too_long`. Prompts state only the configured range (`settings.video`), never the cap.
- `meta.format` is `full` (default) or `card` (title header, 16:9 diagram window, headline,
  subtitles). The Director recommends it (`plan.meta.format`); a run's `settings.format` wins.
  The LLM `meta` spec part (`llmJsonSchema('meta')`) leaves it out.
- A scene's `transitionIn` (cut, fade, slide, zoom-in, zoom-out) applies only to a beat that
  starts a new board; on a `continuesPrevious` beat it is ignored and warned
  (`transition_on_continuing_beat`). `zoomFrom` (with `zoom-in` only, never on a continuing or
  first beat; `invalid_zoom_from`) names an element of the previous board: a semantic zoom.

## Story catalogues

`packages/shared/src/catalogues` (P1C.4): versioned data files with LLM-facing text, the closed
lists for the story layer. `topic-classes` (one entry per `TOPIC_CLASSES`: summary, invented
example topics, `allowedLayoutModes` most typical first, `preferredDevices`), `devices` (25
narrative devices: `DEVICE_IDS`, `DeviceId`), `layout-modes` (ids, zones, `maxUnits`, text) and
`metaphor-worlds` (7 worlds with `{ concept, metaphor }` mappings).

- Each file lists its ids once (`as const`), its entry schema takes `id` from that list and
  `defineCatalogue` validates it at import: entries must be exactly the ids, in order; text is one
  line. **Bump the catalogue's `version` when an entry changes.**
- **Layout mode data lives only here.** The renderer's `layout/modes.ts` joins each entry with
  its placement behaviour (`Record<LayoutModeId, …>`, so a mode without a placer fails
  typecheck); `LAYOUT_MODE_IDS` is re-exported from there.
- Ids the code relies on are typed against the catalogue (`CHAPTER_DISPLAY_DEVICES` and
  `ENDING_DEVICES` satisfy `DeviceId`).
- **Story ids are validated** in `validateVideoSpec` (`integrity/story.ts`): an unknown device
  (`story.devices`, `beats[].device`), metaphor world, beat layout mode or ending device
  (`story.ending.kind` must be one of `ENDING_DEVICES`) is an `unknown_reference` error; an
  explicit layout mode (story beat or scene) outside the topic class's `allowedLayoutModes` is
  the warning `layout_mode_not_allowed` (a beat that takes its pattern's mode is not checked).
  `withRegistryChecks` adds `unknown_reference` for `suggestedPatternIds` and for a
  `missingPrimitiveRequests[].fallbackUsed` that is neither a primitive nor a pattern.
- **Prompt block:** `renderStoryCatalogues()` (shared, pure) writes a `CATALOGUE VERSIONS` line
  and one closed list per catalogue; `catalogueBlock(registries?)`
  (`@explainer-studio/renderer/catalog`) appends every primitive and pattern as compact JSON,
  one per line, in `buildCatalogue` order (code-unit sort, never `localeCompare`). It is
  deterministic for any registry insertion order and leaves assets out.
  `catalogues/__snapshots__/story-catalogues.txt` holds the story part: review its diff.
  **The Generator's block** is `generatorCatalogueBlock(registries?)`: `renderLayoutModeCatalogue()`
  (layout modes and their version only: no devices, topic classes or worlds), every primitive
  as above, every pattern with `params.at` reduced to a pointer at its `anchors`
  (`withAnchorPointer`; the word-anchor shape is stated once, `GENERATOR_ANCHOR_NOTE`), then the
  approved assets of `registries.assets` sorted by family, then id (`assetLines`). About 31k
  tokens at 3.5 characters each; `catalog/__snapshots__/generator-catalogue-size.json` records
  its size per section (review the diff), and a test keeps it under 35k.

## Database

- SQLite via Drizzle + better-sqlite3. Schema: `apps/studio/src/core/db/schema.ts`; DB file:
  `<DATA_DIR>/studio.db`. Enum columns take their values from the Zod enums in `packages/shared`.
- After changing the schema, run `pnpm --filter @explainer-studio/studio db:generate`.
- Migrations are applied only by `db:migrate`, which `dev` and `start` run before the server and
  worker start. Neither process migrates itself, so they never race on the shared file.
- **Until the first real video exists**, migrations may be regenerated from scratch (delete
  `apps/studio/drizzle/` and regenerate) instead of stacking new ones; wipe local `data/` when you
  do. **After that, migrations are append-only:** never edit or delete an applied migration.
- Large JSON and text live in files under the data dir (`runs/<run_id>/`,
  `topics/<topic_id>/sources/<source_id>/<content_hash>.txt`). The DB stores paths relative to the
  data dir; use the helpers in `#core/data-files.ts`.

## Server and worker hand-off

Server and worker are separate processes that share only the SQLite file. **They talk through
tables, not IPC**: no channel exists between them under `concurrently`, and either can restart
without the other noticing.

- **`jobs`** (server → worker). The server inserts a job in the same transaction as the rows it
  acts on (e.g. `startRun` writes the run, its first job and a `run_status` event atomically).
  `run_id` is null for jobs outside a run (asset seeding, reference analysis, drafting).
- **`events`** (worker → server). Append-only progress log; each event has a run, a job or both.
  Types and payloads are a discriminated union (`EventBodySchema`), validated on write.
  `GET /api/events` tails it by `id` and relays it over SSE (event id = SSE id), filtered by
  `runId` or `jobId` (not both). Start cursor, first match wins: `Last-Event-ID` (reconnect),
  `?after=` (pass `lastEventId` from `GET /api/runs/:id`, so page loads never replay history), a
  full replay for one run or job (fallback), else live only.

Worker (`src/worker`): a poll loop claims one job at a time (atomic `UPDATE … RETURNING`,
honouring `run_after`) and runs its handler from `src/worker/jobs/registry.ts`. Every transition
writes a `job_status` event in the same transaction (`#core/services/jobs.ts`).

- **Handlers** declare `type`, a Zod `payloadSchema` and optional `failsRun` (default true: a failed
  job fails its run). Unknown types and invalid payloads fail the job with a clear error.
- **Delivery is at-least-once**, so handlers must be idempotent.
- **Progress** goes through a per-job throttle: at most 1 event per second, leading + trailing (the
  latest dropped value is written when the window ends). `pct: 100`, status and log events always
  pass through.
- **Shutdown** (SIGTERM/SIGINT, including `tsx watch` restarts) aborts the handler's `signal`; a job
  that throws after the abort is requeued and its attempt refunded.
- **Crash recovery** assumes a single worker: on startup every `running` job is stale. It is
  requeued, or failed once it has used `MAX_JOB_ATTEMPTS` (3) hard crashes. There is no
  heartbeat or lease; add one before running a second worker.
- **Handlers get dependencies** through `createJobHandlers({ db, dataDir, tools })`
  (`jobs/registry.ts`); `JobContext` carries only the job, payload, progress, log and signal.

### Source ingestion (`src/worker/ingest`, job in `jobs/ingest.ts`)

- **`ingest` job** (the run's first job, payload `{}`): extracts every source of the run's topic
  that is `pending` or `failed`, one at a time; `extracted` ones are reused, never re-fetched
  (re-fetching is the explicit retry, P1D.2). A source that fails gets `status: failed`, `error`
  (what happened and what to do, e.g. "HTTP 403: the site blocks automated access, so upload the
  page as a file instead …") and `error_code` (`SOURCE_FAILURE_CODES`), plus a `warn` log event;
  the job carries on. Then `recordRunSources` pins the extracted versions to the run
  (`run_sources`): the set the Researcher reads. The job fails (and the run) only when no source
  is usable, or the topic has none.
- **Outputs** (content-addressed by the normalized text's sha256, written atomically, skipped when
  present): `topics/<t>/sources/<s>/<hash>.txt` and `<hash>.chunks.json`
  (`SourceChunksFileSchema`). The row gets `text_path`, `content_hash`, `title` and `extracted_at`
  (the fetch date). Uploads live at `sourceUploadPath(topic, fileHash, name)`, written before the
  row is inserted; only `.md`, `.txt` and `.pdf` are read.
- **Fetching** (`fetch.ts`): http(s) only, the given URL only (redirects followed, nothing
  crawled), `FETCH_TIMEOUT_MS` (20 s) per attempt including the body, `MAX_SOURCE_BYTES` (15 MB)
  checked on Content-Length and while streaming. Timeouts, 429 and 5xx are retried up to 2 times
  with the shared rules in `src/worker/http/retry.ts` (backoff 1 s, 2 s; Retry-After honoured up
  to 60 s), the same ones the LLM transport uses. GitHub repo, `tree`, `blob` and `raw` URLs are
  read as raw markdown (`github.ts`: README through the API, files from
  raw.githubusercontent.com); other GitHub pages are HTML.
- **Extraction** (`extract.ts`): format from PDF magic bytes, then content type, then file name,
  then an HTML sniff. HTML: jsdom (no scripts, no subresources), then **`removeHiddenContent`**
  (`hidden.ts`) drops what a browser would not show (`template`, `noscript`, `script`, `style`,
  embeds, `[hidden]`, `aria-hidden="true"`, and `display: none` / `visibility: hidden|collapse` /
  `content-visibility: hidden` from inline styles and the page's own `<style>` rules), so hidden
  text never reaches the Researcher; then Readability and `domToText` (`#` headings, `- ` items,
  `a | b` rows, fenced `pre`). Markdown is kept minus HTML comments (`markdown.ts`). PDF: the text
  layer via `unpdf` (`pdf.ts`); its title is the Info title, else the first run of the largest
  upright text on page 1 (`pdf-title.ts`, ≤ 120 chars; rotated margin stamps are skipped), else
  the URL's file name (`urlFallbackTitle`) or the upload's name. Every format then goes through `normalizeText` (NFC, invisible
  and control characters removed, whitespace canonical); under `MIN_TEXT_CHARS` (200) is `empty`.
- **Chunks** (`chunk.ts`, pure): whole paragraphs packed to about 1,200 characters (max 2,000;
  longer paragraphs split at sentence ends), a `#` heading never ends a chunk, a short tail joins
  the chunk before. Ids are `source-<id>#chunk-<n>` from 1 (`sourceChunkId` in shared); each
  chunk is `text.slice(start, end)`.
- Tests use saved fixtures in `ingest/fixtures/` (an article with planted hidden instructions, a
  README with HTML comments, and a PDF built by `fixtures/pdf-builder.ts`; all text invented) and
  `ingest/testing.ts` (`fakeWeb`: a URL-routed fake `fetch` and a recording `sleep`).

### Render service (`src/worker/render`, jobs in `jobs/render.ts`)

- **Jobs:** `render_beat_draft` (`{ specVersionId, beatId }`), `render_draft`, `render_final`,
  `render_stills` (`failsRun: false`), all `{ specVersionId }`. The run is `job.run_id`; each
  renders exactly the pinned `spec_versions` row (it must belong to that run; newer versions are
  ignored). `loadRunRenderInput` resolves series and handle from the DB, assets via
  `prepareRenderAssets` and narration at `timing.audioFile` (relative to the data dir).
  Outputs: `runs/<id>/beats/<beat>.draft.mp4`, `runs/<id>/draft.mp4`,
  `runs/<id>/stills/<beat>.png`, `exports/<id>/<topic-slug>.mp4` and `.srt`.
- **Finals export:** `render_final` writes the MP4, then the SRT (`render/srt.ts`: `formatSrt`
  over `targetSubtitleCues`, the very cues the video burns in, same theme and format), then
  records the `exports` row (`recordExport`: duration, the run's LLM cost, title). The row is
  written last, only once both files exist, and is refreshed (not duplicated) when the job
  reruns. A run with an exports row cannot be deleted (`RunHasExportsError`, `restrict` FK).
- **Every output records its spec version** (`{ specVersionId, version }`) in a JSON sidecar
  (`render/manifests.ts`): a clip's `.draft.json` (with its cache key), `draft.json`,
  `stills/stills.json` and `<slug>.json`. The version is not part of the cache key: a reused
  clip keeps the version it was made from, and `draft.json` lists each clip's.
- **Remotion renders silently; ffmpeg muxes narration.** Each beat clip gets its own slice (its
  frame span's offsets), the joined draft and the final get the whole WAV from 0 s. Video is
  always stream-copied (H.264 yuv420p from Remotion); audio is AAC 48 kHz, `+faststart`.
- **ffmpeg** is Remotion's bundled binary, run only through `render/ffmpeg.ts` (internal
  `RenderInternals.callFf`; the build is trimmed, so check a filter exists before using it).
- **Bundle once per process** (`getRendererBundle`); one browser per job. Remotion sits behind
  `RenderEngine` (`engine.ts`), so handlers are tested with fakes (`render/testing.ts`). Only
  the worker may import `@remotion/renderer` / `@remotion/bundler` (ESLint).
- **Draft cache:** a beat clip is re-rendered only when its key changes: `beatRenderInputs` (its
  `continuesPrevious` chain, every beat's span and chapter, global fields, the next semantic
  zoom), the chain's assets, props, preset, encoding, `rendererSourceHash()` and the hash of
  its narration slice. `render_draft` refuses to join when beat spans do not sum to the video.
- **Finals refuse** (`finalRenderBlockers`): no timing, registry errors, `unknown_asset`,
  missing logos or asset files that failed to load. Placeholders and markers are draft-only.
- **Outputs are atomic** (`writeAtomically`: a `.partial` file, then rename) and `ctx.signal`
  cancels Remotion and ffmpeg.
- `pnpm --filter @explainer-studio/studio bench:render [--concurrency N]` renders the
  rate-limiter fixture (cold draft, one-beat edit, unchanged draft, final, stills) with a
  synthetic narration track, prints time and peak RSS (process tree, Chrome included) per phase,
  and checks streams, frame counts, `+faststart` and that the output's silences match the source.

### TTS (`src/worker/tts`, Python in `tts-python/`)

- **`TtsProvider.synthesize(text, voice, speed, { signal })`** returns `{ wavPath, words,
durationSec, cached }`, one call per beat. `words` has one entry per `narrationWords(text)` word
  (that normalized text), in seconds from the start of `wavPath` (24 kHz mono 16-bit PCM, owned
  by the cache: copy it, never edit it). Voice and speed come from `resolveTtsOptions(run
settings, settings.tts)`: speed is the run's `tts.speed`, else `settings.tts.speed` (1.0).
- **Kokoro-82M runs in Python** (`tts-python/kokoro_server.py`), started lazily by the worker and
  reused: JSON lines over stdin/stdout (`ready`/`fatal` handshake, then `synthesize`). The real
  stdout is reserved for the protocol. Env pinned by `uv.lock` (Python 3.12 in `.uv-python/`),
  model files by `models.lock.json` (revision + sha256); runtime loads only `models/`, offline,
  on CPU. Only English voices (`a*`, `b*`): Kokoro times tokens only for those.
- **Supervisor** (`kokoro-client.ts`, `tts-process.ts`): calls are serialised; startup and
  per-request timeouts; errors carry the server's stderr tail; a process that dies, hangs or
  breaks the protocol is restarted once and the call retried, a second failure is thrown. An
  error the server reports for a request is not retried; an abort kills the process.
- **Word timings** come from Kokoro's own per-token `start_ts`/`end_ts` (no forced aligner).
  `alignWords` places each token in the spoken text and spans each word over its tokens. **A
  word with no spoken token fails the synthesis** (`word not spoken: X`); never interpolate
  (Kokoro drops words it cannot read). Kokoro gives a following pause to the word before it, so
  `trimToSpeech` pulls word edges in to audible speech (WAV RMS envelope) where a silence of
  ≥ 60 ms sits inside the span. `wordTimingProblems` checks coverage, order and bounds.
- **Pronunciations** (`<DATA_DIR>/config/pronunciations.json`, `PronunciationsSchema`; missing
  file = `DEFAULT_PRONUNCIATIONS`) respell one whitespace token at a time before synthesis
  (edge punctuation and `'s` kept; a key with capitals matches only that case). The plan keeps
  each original word's range in the spoken text, so timings map back to the original words.
- **Cache** (`<DATA_DIR>/tts/cache/<key>.wav|json`, shared by runs): the key hashes text, spoken
  text, voice (+ its file hash), speed, `TTS_PIPELINE_VERSION` and the model identity read from
  `uv.lock` and `models.lock.json`, so a hit never starts Python; the running server must report
  the same identity. Only checked results are cached. Bump `TTS_PIPELINE_VERSION` when mapping,
  trimming or the server output changes.
- **Timing step** (`src/worker/timing`, P1B.2) and the **`tts` job** (`jobs/tts.ts`, payload
  `{ specVersionId }`): the job synthesises each beat (passing `ctx.signal`), `timeNarration`
  places the beats on one track and the job saves the timed spec as the run's next version
  (`saveSpecVersion`, skipped when identical, so reruns are safe) with the track at
  `runs/<id>/audio/narration-<hash>.wav`. Pauses come from one block, `settings.timing`
  (`beatGapSec` 0, `landingSec` 0, `endTailSec` 0.5), overridden per run by `settings.timing`
  on the run (`resolveTimingOptions`); nothing is hard-coded. A beat's scene ends at
  `max(narration end, settled + landingSec)` (landing only when > 0; `settled` is
  `beatSettledOffsets`: its own last non-exit event played out, draws included, default theme),
  the next beat starts `beatGapSec` later, and the track ends `endTailSec` after the last scene.
  Settled offsets are measured on a first pass and do not depend on where a beat sits, so a
  second pass adds the holds. The track is the beats' PCM with silence of exactly those lengths
  (`buildNarrationTrack`); `timing.pauses` records the values. Without scenes (TTS before the
  Generator) there are no landing holds: re-run the job once scenes exist (TTS is cached).
  Anchors that match no word fail with the closest word.
- `pnpm tts:doctor` checks uv, Python, `uv sync --check`, model checksums, the bundled espeak-ng
  (it reads words missing from misaki's dictionary; the server refuses to start without it), a
  test synthesis and the real-time factor. `… tts:fixture [--no-render]` synthesises the rate-limiter fixture
  per beat into `<DATA_DIR>/tts/fixture/rate-limiter/` (WAV, words, Audacity label track for
  spot checks), times it with `settings.timing` (`narration.wav`, `timed-spec.json`), writes
  `subtitles.srt` and renders `draft.mp4` with the narration and one sentence per sample voice into `<DATA_DIR>/tts/voice-samples/`.
- Tests never need Python: `testing/fake-tts-server.ts` speaks the same protocol (Node runs it
  with type stripping) and can crash, hang, fail at startup or drop a word.

### LLM client (`src/worker/llm`) and agent prompts (`src/worker/agents`)

- **`createLlmClient({ db, dataDir, llm, transport }).callJson({ role, prompt, schema, runId?,
stepId?, aliases?, check?, signal?, log? })`** is the only way to call a model (rule 6). The
  model comes from `settings.llm.models[role]`. Each attempt: normalize the answer, validate it
  with `schema` and run `check` (e.g. registry checks) on it, both together: `check` also runs on
  JSON that fails the schema, so it takes `unknown` and must accept any shape (a throw there is
  ignored). On failure all the errors go back in one assistant + user turn, at most
  `MAX_REPAIR_ATTEMPTS` (2) times, then `LlmOutputInvalidError`. `check(value, { final })`:
  `final` is true on the last attempt, so a check may mark what it would have repaired `soft`
  and handle it after the call (the Curator drops unverified issues instead of failing).
- **Transports:** `httpTransport` (`createLlmTransport(config.llm)`) posts to
  `<baseUrl>/chat/completions` in JSON mode. It retries 429/5xx up to 2 times (1 s, 2 s, or
  `Retry-After` up to 60 s; `src/worker/http/retry.ts`), and a body cut off mid-stream
  (`LlmBodyCutOffError`) like a 5xx, separately from repairs. Each request times out after
  `llm.requestTimeoutSec` (300) and honours the caller's `signal`. A missing key fails before
  any request. `dryRunTransport(fixtures)` / `loadDryRunFixtures(dir)` replay recorded responses
  per role, in order, and run through the same validation, logging and cost. A role recorded
  per key (`{ [beatId]: DryRunResponse[] }`, the Generator) replays from the queue of the call's
  `replayKey` (`CallJsonRequest.replayKey`, passed on `TransportRequest`, written to the prompt
  file; HTTP ignores it), so calls made in parallel replay deterministically; `recordedInOrder`
  reads a role recorded in call order, `recordKeyedResponses` (fixture scripts) records per key.
- **Concurrency:** at most `llm.maxConcurrent` (default 3) requests in flight, across every role:
  one FIFO semaphore per client (`llm/semaphore.ts`) around each HTTP request (the wait is not
  part of `durationMs`; an abort while waiting leaves the queue).
- **Every attempt is an `llm_calls` row** (`#core/db/repositories/llm-calls.ts`): role, role
  prompt and preamble versions, `attempt`, model and served model, cached / uncached input,
  output (reasoning included) and reasoning tokens, cost, normalizer fixes, error. A failed
  request is logged too, then rethrown. Files: `runs/<id>/llm/<key>.prompt.json`
  (messages and versions) and `.response.json` (content, reasoning content, usage);
  `llm/` outside a run. The API key never reaches disk (a test scans the data dir); errors
  redact it. `runCostUsd(db, runId)` sums a run.
- **Cost** (`cost.ts`): cache-hit input, cache-miss input and output at the model's
  `llm.prices`, times `offPeak.multiplier` when the request starts outside the peak windows.
  Usage reads DeepSeek's `prompt_cache_hit/miss_tokens`, else OpenAI's `cached_tokens`.
- **Reasoning content** (`reasoning_content`) is stored in the response file and billed as
  output; it is never parsed as the answer, even when the answer is empty.
- **Normalizer** (`normalize.ts`; also for pasted external JSON): a fixed list of fixes, each
  recorded as a `NormalizerFix` and sent to `log`: strip code fences and surrounding prose;
  rename declared aliases (`{ at: '$.script[*]', from: 'title', to: 'headline' }`, only when
  the target key is absent); turn a plain decimal string into a number where the schema reports
  "expected number" (never inside unions). Nothing else is changed or guessed.
- **Prompts:** `agents/prompts/<name>.v<n>.md` are verbatim copies of the design doc's "Agent
  system prompts" section (`verbatim.test.ts` compares them; Prettier ignores them). Change the
  doc first, add the next file, bump `PROMPT_VERSIONS` and delete the file it replaces: only
  live versions are kept (a test checks it; each call's prompt file holds the full messages it
  sent, and git keeps the old files). `buildPrompt(templates, parts)` puts
  preamble, role prompt, the role's output JSON Schema (`ROLE_OUTPUT_SCHEMAS` in
  `agents/output-schemas.ts`, rendered with `z.toJSONSchema`, input side), catalogue,
  references (Director only) and style rules in the system message and the run's input in the
  user message, so the static prefix caches. A new agent registers its output schema there and
  passes the same schema to `callJson` (the Curator does not: its two passes put their shapes in
  the user message, `outputSchemaSection`, so both share one system prompt). `{{name}}`
  takes values from `resolvePromptVariables(run settings, settings.video)` (run override →
  app settings → defaults 45, 150, 90, true, 4, 2.56, `beginner`; `explanationLevel` is
  beginner | intermediate | expert and fills the preamble's audience line); an unknown, unfilled or malformed
  placeholder throws `PromptBuildError`. `__snapshots__/<role>.prompt.txt` holds each assembled
  prompt with the defaults: review the diff when one changes.

### Researcher (`src/worker/agents/researcher`, job in `jobs/research.ts`)

- **`research` job** (payload `{}`): reads the chunks of the versions pinned to the run
  (`loadRunSources`: `run_sources` → `<hash>.chunks.json`), applies the source token budget,
  builds the prompt (user message: topic, angle = `topics.notes`, series and the sent chunks as
  JSON, so a source cannot forge chunk boundaries) and calls `callJson` with
  `ResearchNotesSchema` and `check: researchNotesProblems`, so check failures are repaired like
  schema errors.
- **Steps:** every attempt is its own `run_steps` row (`#core/db/repositories/run-steps.ts`,
  stage `research`; never reused), whose id goes on its `llm_calls` rows. Files:
  `runs/<id>/research/input-<step>.json` (`ResearchInputSchema`: chunks sent, budget, chunks
  left out) and `notes-<step>.json`. A step still `running` when the job starts again was
  interrupted and is marked failed. **Gate 1 input** is `latestResearch(db, dataDir, runId)`
  (`#core/services/research-notes.ts`): the newest `done` step's notes and input, validated.
- **`ResearchNotes`** (`packages/shared/src/research`): mechanism (summary + steps),
  `plainSummary` (the mechanism in plain words), 1–2 `analogies` (`analogy`,
  `matches`, `breaksDown`), `glossary` (`term`, `plainMeaning`, cited), facts
  (`fact-<n>`, confidence), numbers (`num-<n>`, `value` exactly as the chunk writes it, unit,
  context, one `sourceChunkId`, optional `asOf`), trade-offs, rejected alternatives,
  misconceptions, failure modes (edge case / failure mode / incident with date and publisher),
  2–4 hooks and open questions (`disagreement` / `not_covered`). Every item cites chunks
  except `plainSummary`, analogies and open questions with nothing to cite; analogies and
  uncited open questions may carry no number, and `plainSummary` only numbers whose value
  matches an entry in `numbers` (same token comparison as `number_not_in_source`). Fact and number ids are slugs, so `factIds` and stat card
  `sourceRef`s can point at them.
- **Checks** (`researchNotesProblems(notes, chunks)`, pure, shared so gate edits and imports
  run them too; takes any JSON value, so the LLM client runs it before the schema passes):
  `unknown_chunk` (a citation not among the chunks sent), `number_not_in_source`
  (a number's value not in its chunk: digit tokens compared, words matched as text),
  `unsourced_number` (a quantity in any text that none of the item's own cited chunks states;
  a number's `asOf` and an incident's `date` may come from any chunk of the cited source;
  analogies and open questions that cite nothing also carry no number written as a word,
  `numberWordTokens`, everyday "one", "two" and "three" excepted, so "twenty-two" still fails)
  `duplicate_id` and `number_value_not_numeric` (a `numbers[].value` has a digit or reads as a
  spoken number, `numberMentions`; "thousands" or "many" belong in facts). Numbers are digit runs with `.`/`,` groups, grouping commas ignored,
  whole tokens only (`numbers.ts`). **Digits glued to letters are identifiers and skipped**
  (`IPv4`, `L7`, `p99`, `SHA-256`, `HTTP/2`, `UTF-8`, `O(1)`), and so is a status code (100-599)
  after "HTTP", "status" or "error" (`HTTP 429`); digits followed by letters stay quantities
  (`50ms`, `10k`, `5xx`). Glossary entries are checked like any cited item.
- **Source token budget** (`settings.research.sourceTokenBudget`, default 60,000 estimated
  tokens at 4 characters each; `select-chunks.ts`, pure): above it, each source gets a max-min
  fair share, keeps its first `KEEP_FIRST_CHUNKS` (2) chunks even past its share (so the budget
  is soft with many sources), then fills the share with the chunks most relevant to the topic
  and angle (distinct query terms matched, then density, then order; plurals folded,
  stopwords dropped). Kept chunks stay in source order. Left-out chunks are recorded in the
  step input and logged as a `warn`.
- **Fixture:** `agents/researcher/fixtures/rate-limiter/` holds three invented sources
  (an article, a library README and a post-mortem that disagree on fail open vs closed) and
  `responses/researcher.json`, the dry-run answer `jobs/research.test.ts` replays. It is
  hand-written until recorded: `pnpm --filter @explainer-studio/studio research:fixture
[--level beginner|intermediate|expert] [--record]` runs ingestion and the Researcher on those sources against the configured model
  in a scratch data dir (`<DATA_DIR>/research/fixture/rate-limiter/`, its own DB), prints the
  log, check result and cost, and with `--record` replaces the dry-run answer (every attempt,
  repairs included). `fixtures/oversized-source.ts` builds the long source of the budget test.

### Director (`src/worker/agents/director`, job in `jobs/direct.ts`)

- **`direct` job** (payload `{}`): reads the run's latest research notes (`latestResearch`; none
  fails the job), its memory (`directorMemory`, `#core/services/director-memory.ts`: active style
  rules scoped `director` or `all`, usage of the last `RECENT_VIDEOS` (5) exported videos, past
  exported topics) and the run's length / parts / level / format settings, then calls
  `callJson` with `DirectorPlanSchema` and `check: directorCheck(...)`. The prompt carries the
  summaries-only catalogue (`directorCatalogueBlock()`, renderer: ids, family, summary, when /
  when not; patterns also layout mode, formats and anchor names; no props or params, ~10k
  tokens) and style rules as section 5; the user message holds topic, angle, series and its next
  number (`nextSeriesNumber`), the length instruction (fixed `lengthOverrideSec`, else the
  configured range), parts, format, recently used ids and combos, past topics and the notes
  without chunk ids. References (P1C.11) come from an optional `references` dep: none yet.
- **Steps and files** like the Researcher: one `run_steps` row per attempt (stage `direct`),
  `runs/<id>/direct/input-<step>.json` (`DirectorInputSchema`) and `plan-<step>.json`. **Gate 2
  input** is `latestDirection(db, dataDir, runId)` (`#core/services/direction.ts`). The job writes
  no spec version: turning the plan into specs (and parts into runs) is P1C.9's.
- **`DirectorPlan`** (`packages/shared/src/director`) is shaped like a spec: `meta` (title, topic
  class, recommended `format`, `targetLengthSec` unless there are parts), `lengthReason`, `story`
  (the Story layer; code fills `ending.seriesNumber`) and optional `parts` (`part`, `title`,
  `mainIdea`, `beatIds`, `targetLengthSec`). `specFromPlan(plan, { id, series, formatOverride,
seriesNumber })` makes the spec; with parts its `targetLengthSec` is the parts' total within the
  hard limits. Plan lengths carry no hard cap in the schema (prompts state only the range).
- **Story fields the Director fills:** `runningExample` (one sentence), `beats[].continuesPrevious`
  (a suggestion for the Generator: the beat keeps the previous board), `beats[].newTerms`
  (glossary terms introduced), `beats[].source` (real-incident footnote, carried into the
  script), `rejectedAlternative.chosenBeatId`, `ending.specCard` (3 lines of at most 40 chars).
- **Checks** (`directorPlanProblems`, shared, pure; `directorCheck` adds the spec and registry
  checks and `hudTextWarnings` on a placeholder renderable spec, also when the spec has reference
  errors (its shape is checked), so one repair covers both; paths pointing into the plan):
  research ids exist (`unknown_fact`); at beginner a beat cites at most
  `BEGINNER_MAX_FACTS_PER_BEAT` (3) `fact-*` ids, numbers aside (`too_many_facts_in_beat`), and
  `BEGINNER_MAX_NUMBERS_PER_BEAT` (2) research numbers, counted by id: each `num-*` id (and
  hook number) once whatever its value lists ("one, one and three" is one number), plus the
  research numbers its intent states that no cited id holds (`numberIndex` /
  `researchNumberOf`, `script/note-values.ts`; dates aside) (`too_many_numbers_in_beat`; both limits are hinted in `factIds`' schema description); new terms match the glossary case-insensitively
  (`unknown_term`), at most 1 per beat and `NEW_TERM_LIMITS` distinct per level (3 / 5 / no
  limit); no beat's intent, source line, chapter title or question (from the chapter's first
  beat) or hero metric (from the first beat) names a later beat's new term (`term_before_intro`;
  one system per story (`director/systems.ts`): in a plan with a `real_incident` beat, the
  incident's sources are those its incident beats cite, and a beat citing a research number
  from any other source must set `beats[].exampleNumbers` (`mixed_system_numbers`, one problem
  per beat and source, naming the source by title);
  `containsPhrase`, `text/phrase.ts`: whole words, any case, plain plural); a beat's `source` is
  not bare (`source_label_bare`: one word, or only a source's site or library name,
  `bareSourceNames` / `isBareSourceLine` in `research/source-names.ts`; the Scriptwriter checks
  its lines the same way); `runningExample` at beginner; each video or part plans the override or a length in the
  range, beats sum to it ±10%, a `lengthReason` above `lengthReasonAboveSec`; parts are allowed,
  at most `maxParts`, numbered 1..N, cover every beat once in order, and keep each chapter,
  planted question and rejected / chosen pair inside one part; devices get what they need
  (`plantedQuestion`, `heroMetric`, chapter questions, a real incident's `source`, facts and an
  incident in the notes); a `failure_before_fix` device or a `rejectedAlternative` with its
  `chosenBeatId`; each video's hook (first beat after a recap) opens as `story.hook.kind` says
  (`HOOK_KINDS`; missing in older plans and specs = `problem`; the topic class plays no part): a
  `problem` hook names its one or two research numbers in `beats[].hookNumberIds` (schema
  `maxItems` `MAX_HOOK_NUMBERS`, 2) when the notes have numbers (`hook_without_number`); a
  `puzzle` hook's intent is a question with a "?" (`hook_not_question`) using at most
  `MAX_PUZZLE_HOOK_NUMBERS` (1) research number, ids and intent values together
  (`hook_too_many_numbers`); either way no `num-*` is left in its `factIds` (`hook_numbers_in_fact_ids`), and only hooks
  carry `hookNumberIds` (`hook_numbers_off_hook`); every number in the plan's prose (beat
  intents, planted question, rejected alternative, chapter titles and questions, running
  example, hero metric and story clock labels, spec card lines) is a research number value or a
  date the notes give (`number_not_in_notes`, `quantityTokens` as the Researcher's check: no
  derived numbers, identifiers such as p99 or HTTP 429 skipped); the planted question's payoff is at least
  `MIN_PAYOFF_GAP_BEATS` (2) beats later; a device sits on at most `MAX_BEATS_PER_DEVICE` (2)
  beats (`recap_opening` and `cliffhanger_ending` aside, one per part) and every device in
  `story.devices` is on at least one beat (`devices_unused`); the `cta` has no digits
  and not the series name or label as whole words (code adds them; "AI" is not found in
  "explain"); the single video or last part closes with an ending device other than
  `cliffhanger_ending` and its `ENDING_REQUIREMENTS` (spec card: `specCard` and `cta`; callback
  and real-world closure: `cta`); earlier parts end on a `cliffhanger_ending` beat, parts 2+ open
  on a `recap_opening` beat; more than `MAX_RECENT_COMBO_REUSE` (1) beats reusing a recent
  `<device>/<layout>` combo (usage kind `device_layout`) flags each. Per video (or part), with a
  `continuesPrevious` chain counted as one scene (its mode is its first beat's): a layout mode
  lays out at most `MAX_SCENES_PER_LAYOUT_MODE` (2) scenes (`layout_mode_overused`), two scenes
  in a row never share a mode (`layout_mode_repeated`), a pattern is suggested on at most
  `MAX_BEATS_PER_PATTERN` (2) beats (`pattern_overused`), and a video's first beat never
  continues (`continues_without_previous`); a scene spans at most `MAX_BEATS_PER_SCENE` (3) beats
  (`scene_too_long`), so chains cannot carry the whole video. The spec's
  `target_length_mismatch` is dropped (the plan checks length per video or part).
- **Fixture:** `agents/director/fixtures/rate-limiter/responses/director.json`, the dry-run plan
  `jobs/direct.test.ts` replays after ingesting the Researcher's sources and replaying its recorded
  answer (recorded from the configured Director model, repairs included; the job tests derive
  their expectations from it). Re-record with `pnpm --filter @explainer-studio/studio director:fixture
[--level beginner|intermediate|expert] [--record]` does the same against the configured
  Director model (the Researcher is replayed, never called) in
  `<DATA_DIR>/director/fixture/rate-limiter/`, prints each attempt's issues, the Director's cost
  and the plan, and with `--record` replaces the dry-run answer.

### Scriptwriter (`src/worker/agents/scriptwriter`, job in `jobs/script.ts`)

- **`script` job** (payload `{}`): reads the run's latest plan (`latestDirection`; none fails the
  job) and the notes of the research step that plan was made from (`researchOfStep(input.
researchStepId)`, not the newest research), the run's level and pace (`resolvePromptVariables`)
  and pauses (`resolveTimingOptions`), and style rules (`activeStyleRules(db, 'scriptwriter')`,
  `#core/services/style-rules.ts`, shared with the Director), then calls `callJson` with
  `ScriptwriterOutputSchema` and `check: scriptwriterCheck(...)`. No catalogue section. The user
  message (`scriptwriterUserMessage`) resolves everything per beat: word budget, new terms with
  their glossary `plainMeaning`, hook numbers, facts and numbers, `source`; every number carries
  its source title (for source lines). Notes go without chunk ids (`agents/sections.ts`).
- **Steps and files** like the Director: stage `script`, `runs/<id>/script/input-<step>.json`
  (`ScriptwriterInputSchema`: the direct and research step ids, level, pace, pauses, budgets,
  style rules) and `script-<step>.json`. `latestScript(db, dataDir, runId)`
  (`#core/services/script.ts`) reads the newest. The job writes no spec version (P1C.9).
- **`ScriptwriterOutput`** (`packages/shared/src/script`) is `{ script: [...] }`, the spec's
  Script layer with stricter limits: on-screen text takes `ON_SCREEN_TEXT_LIMITS`, which the
  `tag`, `stat_card`, `command_bubble` and `formula_card` props schemas also read (one source),
  at most `MAX_TAGS_PER_BEAT` (3) tags, stat cards cite `num-<n>` (their counts are checks,
  not schema limits, so a repair never lists one twice), and `headline.at` is left to its
  default.
- **Word budget** (`wordBudgets`): `(targetSec − landingSec − beatGapSec) × wordsPerSec`, ±15%
  (`WORD_BUDGET_TOLERANCE`), rounded; a video's (or part's) last beat has no gap, and the end
  tail is not taken. Words are `narrationWords`.
- **Checks** (`scriptProblems`, shared, pure, on any script layer): `narration_over_budget` /
  `_under_budget`, `sentence_too_long` (over `MAX_SENTENCE_WORDS`, 20), `numbers_per_sentence`
  (beginner only; a "from X to Y" range is one number, and a lone "one", "two" or "three" counts
  when a unit follows it, `NumberMention.measured`: "two seconds"), `numbers_per_beat` (beginner:
  at most `MAX_NUMBERS_PER_BEAT` research numbers in a narration; both density checks count a
  research number once whatever its value lists, `researchNumberOf`, and leave out
  lone everyday words and values the notes give only as dates), `digits_in_narration` (narration
  has no digits; stat cards, tags and source lines may), `example_not_labelled` (in a beat the
  plan marks `exampleNumbers`, the sentence that first says one of its example numbers, or the
  one before, has a marker from `EXAMPLE_MARKERS`, `script/example-markers.ts`),
  `example_tied_to_incident` (no sentence that says an example number, nor the one before,
  names the incident's organisation: `incidentNames`, `script/incident-names.ts`, from the
  incident beats' source lines, their sources' titles and publishers and the names their
  narration uses; a narration sentence's first word counts only before another name word), `number_not_in_notes` (narration, headline, tags, stat card labels, formula
  caption, command; not sources or LaTeX), `stat_card_not_a_number`, `stat_card_value_mismatch`,
  `hook_number_missing` (the beat with `hookNumberIds` says each), `new_term_missing` /
  `new_term_too_early` (`mentionsTerm`, `script/terms.ts`: whole words, any case, each word
  singular or with `s|es|ed|ing`), `topic_not_defined` (beginner: the first
  `TOPIC_DEFINED_BY_BEAT` (2) beats of each video name `mainTerm`, the longest of the topic title
  and glossary terms that `meta.title` names, else the topic title; skipped when a later beat's
  `newTerms` introduce it) `source_missing` (a planned `source`, or stat cards) `source_changed` (a planned
  `source` is kept word for word, unless it is bare) and `source_label_bare`. Budget and per-sentence messages name the rule a fix tends to
  break (one number per sentence; the beat's words left), so repairs do not oscillate. On-screen
  checks (`script/screen-checks.ts`): `stat_cards_per_beat` (`MAX_STAT_CARDS_PER_BEAT`, 1),
  `stat_cards_per_video` (`MAX_STAT_CARDS_PER_VIDEO`, 4, per part), `stat_card_not_spoken`
  (the card's number is said in its beat), `tag_repeats_stat_card`, `too_many_tags_continuing`
  (a `continuesPrevious` beat asks for at most `MAX_TAGS_CONTINUING` (1) tag: its board is
  already full), `headline_not_concept` (a
  beat with `newTerms` has a `concept` headline "<term> = ...") and `headline_repeated` (two
  headlines share more than half the content words of the shorter, stopwords dropped). Codes,
  context and `planVideos` live in `script/context.ts`. `scriptwriterCheck` adds spec validation
  of plan + script, `hudTextWarnings` (headlines), `subtitleWarnings` and the layout's
  `text_truncated` (sources) on `previewSpec` (`agents/preview-spec.ts`: empty boards, estimated
  timing; the Director uses it too) and each on-screen item against its primitive's props
  schema (LaTeX via `latexProblem`), keeping only issues under `$.script`. An answer that fails
  only the output schema's limits is still checked against the spec's looser Script layer, so
  one repair covers both (the primitive checks then wait).
- **Numbers by value** (`numberMentions`, `script/number-mentions.ts`): digits (grouping commas,
  `10k`, `2M`, `2 million`) and spoken numbers ("ten thousand", "two point one", "twenty-four",
  "a hundred", pairs as years or codes: "twenty twenty-five", "four twenty-nine"), compared with
  the notes' values, `asOf` dates and incident dates by `numberKey`. A lone "one", "two" or
  "three" is everyday (never counted); identifiers are skipped as in `quantityTokens` (`p99`,
  "p ninety-nine", "HTTP four twenty-nine"). Ordinals are not read.
- **Fixture:** `agents/scriptwriter/fixtures/rate-limiter/responses/scriptwriter.json`, the
  recorded answer (repairs included) that `jobs/script.test.ts` replays after the Researcher
  and Director fixtures; the tests derive their expectations from it. `pnpm --filter @explainer-studio/studio scriptwriter:fixture [--level
beginner|intermediate|expert] [--record]` runs the Scriptwriter live (the others replayed) in
  `<DATA_DIR>/scriptwriter/fixture/rate-limiter/` and prints each attempt's issues, the cost and
  each beat's budget vs words, headline, narration, tags, stat cards and source. The fixture
  scripts share `scripts/agent-fixture.ts`.
- **Fixture topics** (`agents/fixture-topics.ts`, `FIXTURE_TOPIC_IDS`): `rate-limiter` (System
  Design; incident, many numbers) and `tokenizer` (AI; concept, no incident, few numbers). Each
  has invented sources in `researcher/fixtures/<topic>/sources/` and per-role recordings in
  `<role>/fixtures/<topic>/responses/<role>.json`. `research:fixture`, `director:fixture` and
  `scriptwriter:fixture` take `--topic <id>` (default `rate-limiter`) and write to
  `<DATA_DIR>/<agent>/fixture/<topic>/`; an earlier role replays its recording for the topic, or
  runs live when there is none (`chainTransport`), so an unrecorded topic runs the whole chain.
  `--record` writes only the script's own role, and with `--max-repairs <n>` only when that role
  needed at most `n` repairs (`shouldRecord`). The job tests use the rate limiter. Fixture runs
  pin `video.wordsPerSec` at 2.7 (`fixtureRunSettings`), the pace their Scriptwriter recordings
  were made at; the app default (2.56) is Kokoro's measured rate (`DEFAULT_VIDEO_SETTINGS`).

### Generator (`src/worker/agents/generator`, job in `jobs/generate.ts`; P1C.7)

- **`GeneratorOutputSchema`** (`packages/shared/src/generator`): one beat's board without what
  the plan decides (`beatId`, `kind`, `continuesPrevious`, `layoutMode`): elements, patterns,
  events, focus, `transitionIn`, `zoomFrom`, optional `missingPrimitiveRequests`. Every anchor,
  in events and in a pattern's `params.at`, is a word index (`GeneratorAnchorSchema`).
  `generatorScene(output, storyBeat)` adds the plan's fields (a layout mode only on a board's
  first beat) and drops the requests. Registered in `ROLE_OUTPUT_SCHEMAS`.
- **`assembleScriptedSpec(plan, script, ctx)`** (`director/spec.ts`): `specFromPlan` plus the
  script, the spec before TTS (P1C.9 saves it as version 1; the Scriptwriter check uses it).
- **Prompt prefix:** the system message is the same for every beat of every run with the same
  settings and registries: catalogue and assets in the block, per-run lists (logo slots, allowed
  layout modes) and the beat in the user message. `generator/prefix.test.ts` builds a prompt per
  beat of both fixture topics (`generator/testing.ts`: `fixtureScriptedSpec`, from the recorded
  Director and Scriptwriter answers) and checks the system messages are byte-identical.
- **`generatorCheck(deps)`** (`generator/check.ts`, the `check` for `callJson`): the beat's
  board (`generatorScene`) spliced into the run's spec (scenes generated so far; empty
  placeholders elsewhere), then `withRegistryChecks(validateRenderableVideoSpec)`,
  `specLayoutWarnings` (run format, default theme) and `beatCheckWarnings`. It keeps this beat's
  issues (paths rewritten into the answer: `$.scenes[3].events[0]` → `$.events[0]`) and issues
  the answer causes in earlier beats of its board (diffed against the spec without it; the
  message says so). Near-identical asset ids (`nearIdenticalAsset`: case, `_`/`-`, plural `s`/
  `es`, an alias) are swapped first (`generatorAssetSwaps`, for the step to log); other
  `unknown_asset` issues are **soft** (`OutputIssue.soft`: listed as advisory in a repair turn,
  never the reason for one, never a failure).
- **Per-beat scene checks** (`catalog/beat-checks.ts`, `beatCheckWarnings`; warnings, the
  Curator reuses them): `focus_missing` (a board with no `focus` and no focus event),
  `beat_without_motion` (no event and no pattern), `beat_without_change` (P1C.8: no new element
  or pattern, no focus shift, no camera move; an empty new board), `zoom_from_unplanned`
  (`zoomFrom` off a `semantic_zoom` beat), `events_share_word` (more than
  `MAX_UNRELATED_CHANGES_PER_WORD` (2) changes with no target in common on one word),
  `events_under_ending_card` (an event or pattern anchor in the final beat's last sentence),
  `board_too_busy` (more than `MAX_BOARD_UNITS` (7) layout units plus overlay children at the
  beat's settled moment; 7 is the busiest golden or pattern board, `split_brain`, and a test
  recomputes it), `highlight_everything` (one highlight covering every unit of a board of 3
  or more) and `element_without_enter` (an element or pattern instance the beat adds has no
  `enter` on a word, so it shows before the narration names it; the beat's starting `focus` and
  anything pinned to, inside or following an element that enters on a word are exempt). A
  continuing beat that declares an inherited id again is `duplicate_id`
  (`validateVideoSpec`).
- **Schema metadata** (`common-props.ts`): `AssetIdSchema` carries `assetId`, `displayNumber()`
  marks numbers drawn on screen (with a `unit`: `sec` for durations; counter, timer, time bar,
  data values, pattern rates, holds and outages), `notScreenText()` marks LaTeX and
  `drawnText()` a patterned string that is drawn as written (`data_block` field names).
  `catalog/schema-leaves.ts` walks props and params against their JSON Schema and returns the
  asset, text and number leaves (anchors excluded), for any primitive or pattern.
- **On-screen text checks** (`catalog/screen-checks.ts`, `screenTextWarnings(spec, { notes })`;
  `generatorCheck` passes the run's notes): the script's tags, stat cards, formula card and
  command bubble (`SCRIPT_PRIMITIVES`) are each placed once as written (`script_text_missing`;
  a loose one that matches none is `script_text_changed`; tags compare without case). Text the
  Generator writes (every other leaf; script items are the Scriptwriter's) is checked for
  `screen_number_not_in_notes` (each counted number, and each `displayNumber` value, is a value
  the board's beats so far cite or say; `sec` values compare with research times converted by
  code, so 600 matches "10 minutes"; identifiers such as p99 and HTTP 429 and counts 0-3 are
  free; a counter's number (`steppingNumber`: `counter`, `counter_transition`) may also step a
  research value by 1 to `MAX_DISPLAY_STEP` (3), as a token being spent; skipped without notes) and `label_term_too_early` (a glossary term a later beat
  introduces). Example numbers need no marking: code draws the EXAMPLE stamp (see Renderer).
- **Across boards** (`catalog/layer-checks.ts`, `layerWarnings`; the Generator's post-pass and
  the Curator): `pattern_repeated_on_focus` (consecutive beats focus a new instance of the same
  pattern) and `static_beats` (more than `MAX_STATIC_BEATS` (1) new board with nothing but stat
  cards).
- **Stat card beside the footnote:** a primitive's `besideFootnote(props, footnote)` hook gives
  the props to draw beside a beat's source line; `stat_card` drops its own source line
  (`source: ''`) when it matches. `beatWorld` applies it per drawn beat (`FootnoteMode` `beat`:
  only while the beat on screen has that footnote); layout sizes with `chain` (only when every
  beat from the one that adds it to the end of its board has it), so a card is never drawn
  larger than its box.
- **The user message** (`generator/input.ts`, `generatorUserMessage`): sections VIDEO (title,
  running example, planted question), BEAT, SCRIPT, NARRATION WORDS (one line per
  `narrationWords` word: index, word as written, seconds from the beat's start; the beat's
  length; on the final beat, the words the ending card covers), RESEARCH (the beat's facts; the
  numbers its board may show, `boardNumberIds`, the same list the number check allows), TERMS
  (introduced so far with plain meanings, and `notYet`), BOARD (format, layout mode with zones
  and `maxUnits`: the plan's on a board's first beat, the generated first scene's on a
  continuing beat; logo slots); on a continuing beat, ON SCREEN and PREVIOUS BEAT; on a
  `semantic_zoom` beat, ZOOM FROM (the previous board's present components: a primitive that
  declares `zoomable` (cards, icons, data blocks, devices) and is not pinned, or a pattern
  instance and its zoomable inner elements; never tags or other annotations). ON SCREEN comes from
  `boardState(spec, previousBeatId)` (renderer `catalog/board-state.ts`, pure): every element and
  instance the board declared, its text, present or exited, held reject / lock (whole and per
  part), held highlight, actions and parts, which pins it can host (`catalog/pin-hosts.ts`,
  `primitivePinHost`: any side, a connector's middle only, none on a pattern instance or its
  inner elements), inner ids with `innerActions`, the focus, the units against `maxUnits` and
  the board's scale headroom (`space left`), as the previous scene leaves the screen. `generator/board.ts`
  (`spliceBoards`, `placeholderScene`, `boardStart`) is shared with the check. Snapshots in
  `generator/__snapshots__/` (rate limiter beat4, continuing; tokenizer b3, semantic zoom) show
  what the model reads: review their diff.
- **`generate` job** (`jobs/generate.ts`, payload `{ specVersionId, beatId?, feedback? }`):
  draws every board of the pinned spec version (it must have a script; timing is used when
  present) from the notes of the plan's research step, with registries whose assets are the DB's
  approved rows (`loadAssetLibrary` → `buildAssetRegistry`; the prompt lists and the checks use
  the same ones), and saves the spec with its scene layer (and the beats'
  `missingPrimitiveRequests` in `story`) as the run's next version; `recordMissingAssets` writes
  `missing-assets.json`.
  - **Order** (`generator/schedule.ts`, pure): a beat waits for the previous one when it
    continues that board or is a `semantic_zoom` beat (`beatDependency`); other chains run in
    parallel under the client's `llm.maxConcurrent`. The first call runs alone
    (`createWarmUp`), so the rest hit the cached prefix. A beat sees only its ancestors' boards
    (`visibleScenes`), so its input never depends on which parallel chain finished first. A
    failed beat fails the job after the others settle.
  - **Steps:** one whole-stage `run_steps` row per job (`beat_id` null; `generate/input-<step>.json`,
    `GenerateInputSchema`, and `output-<step>.json`, `GenerateOutputSchema`: beats by outcome
    `generated` / `reused` / `kept`, `retried`, the saved version, warnings, the job's usage) and
    one per beat attempt (`beat_id`; `generate/<beat>/input-<step>.json` with `reason` and
    `inputHash`, `scene-<step>.json` with the scene, asset swaps and requests;
    `generator/beat-step.ts`, `drawBeat`). **Resume:** a finished beat step with the same
    `inputHash` (model, prompt versions and messages, check kind, a regenerate's job id) is
    reused without a call. `latestDoneStep` ignores beat rows; `doneBeatSteps` lists them.
    `latestGeneration` (`#core/services/generation.ts`) is gate 3's read.
  - **Post-pass:** with every board in place, each beat drawn in this job is checked again
    (`generatorSceneCheck` with `crossBoard`: also `layerWarnings`, and what needs the next
    board); one that fails gets one retry with its issues as FEEDBACK (the user message's last
    section), in beat order, and then the later beats of its chain are re-checked against the new
    board and redrawn only when they fail (`redrawBrokenDependents`, the regenerate's path); a
    retry that still fails keeps its board. Every issue left, soft
    ones included, goes into the job output's `warnings` for gate 3.
  - **Regenerate** (`beatId`, optional `feedback`): that beat is drawn again (always called),
    the others are `kept` from the pinned spec (which must have every board); each later beat of
    its chain is re-checked against the new board and redrawn (`revalidate`) only when it fails.
  - The summary log line gives boards by outcome, calls, cost and cache hits against input
    tokens. `jobs/generate.test.ts` replays hand-written boards (`rateLimiterBoards()` in
    `generator/testing.ts`) through a transport that imitates the provider's prefix cache.
- **Fixture scripts:** `generator:timing [--topic]` synthesises the topic's recorded script with
  Kokoro into the committed `agents/generator/fixtures/<topic>/timing.json` (`TimingFixtureSchema`;
  `withFixtureTiming` places it like the TTS job, and refuses a script whose narration changed).
  `generator:fixture [--topic] [--level] [--beat <id>] [--record [--max-repairs <n>]]` runs ingest
  and the recorded Researcher, Director and Scriptwriter, saves plan + script + fixture timing
  as spec v1, then the `generate` job live (with `--beat`, only that beat and its chain; the rest
  replay the Generator recording) in `<DATA_DIR>/generator/fixture/<topic>/`, and prints each
  beat's attempts with issue codes (`llm_calls.error` lists them: `invalidOutputError`), usage
  and cache hits, the post-pass, assets and every board with its words. `--record` writes the
  keyed recording only when the job finished within `--max-repairs` per beat.
  `jobs/generate.test.ts` replays both topics' recordings (P1C.7's acceptance: every recorded
  call used, no retry, nothing for gate 3).
- **`draft:fixture [--topic] [--live]`** (needs `pnpm tts:setup`): the whole pipeline to a
  draft through the real job handlers, in `<DATA_DIR>/draft/fixture/<topic>/` (rebuilt each
  run; the Kokoro cache stays in the main data dir): the recorded chain, spec v1, `tts`,
  `generate` (replayed; `--live` calls the model), `tts` again (landing holds),
  `render_draft` and `render_stills`. Prints each stage's time, the Curator's checks on the
  final version and the run's warning logs, and writes `contact-sheet.png` (one still per beat,
  `scripts/contact-sheet.ts`).

### Curator (P1C.8; job `jobs/curate.ts`, review only so far: the repair loop follows)

- **`curatorCodeChecks(spec, ctx)`** (`renderer/src/catalog/curator-checks.ts`, pure, exported
  through `catalog` so gate saves can run it): every code check on a finished spec (the re-timed
  spec after the Generator, or a gate edit), each finding a `CodeIssue` (shared
  `curator/issue.ts`): the `SpecError` plus `severity` (`blocking` | `advisory`) and `owner`
  (`scriptwriter` | `generator` | `director` | `researcher`; only the first two are ever
  auto-repaired, `REPAIRABLE_OWNERS`). `ctx` (`CuratorCheckContext`): theme, notes, topic title,
  series name and label, handle, resolved `settings.video`, `lengthOverrideSec`, pauses, recent
  usage (`directorMemory`: combos, patterns), source names and sources.
- **What runs:** validation errors (always blocking; then nothing else runs) and warnings
  (`withRegistryChecks`); `specLayoutWarnings` with the chain-level `text_too_small` replaced by
  `text_too_small_on_screen`; HUD text and subtitles; `beatCheckWarnings`,
  `screenTextWarnings` (with notes) and `layerWarnings`; `colourWarnings`;
  `sourceMissingOnScreenWarnings`; `patternVarietyWarnings`; `directorPlanProblems` on
  `planOfSpec(spec)` (shared: the spec as a one-video plan) less what only a plan has (planned
  length, parts: `PLAN_ONLY_CODES`); `scriptProblems`, less the word budgets once the spec is
  timed; then `timedLengthProblems`, `hookNumberRepeats` and `readabilityProblems` (shared
  `curator/`). De-duplicated by path and code.
- **Severity and owner:** `CURATOR_CODE_POLICY` rates every warning code (blocking:
  `BLOCKING_WARNING_CODES`: unreadable or hidden text, script items or numbers not as written,
  numbers and facts not in the notes, missing attribution, `beat_over_target`,
  `video_out_of_range`, `hook_number_repeated`); a test fails when a code any fixture raises,
  or any plan, script, layout or spec warning code, has no rating. The owner follows the path
  (`ownerOfPath`: `$.scenes` Generator, `$.script` and `$.timing` Scriptwriter, the rest Director).
- **New checks:**
  - **Length after TTS** (`timedLengthProblems`, timed specs only): a beat's scene span (narration,
    gap, landing; the last beat without the end tail) over `BEAT_OVER_TARGET_RATIO` (1.25) × its
    `targetSec` is `beat_over_target` (with words to cut at its measured rate); the beats over
    `VIDEO_OVER_TARGET_RATIO` (1.1) × the target (or the run's fixed length) are
    `video_over_target`; the whole video outside `settings.video`'s range is
    `video_out_of_range` (not with a fixed length).
  - **`hook_number_repeated`**: a later beat's narration says a `hookNumberIds` value (everyday
    one to three aside), unless it cites another research number with that value.
  - **`readability_low`**: Flesch reading ease (`text/readability.ts`, vowel-group syllables)
    below `READABILITY_THRESHOLDS` (beginner 60, intermediate 50, none for experts). Neither
    recorded topic goes below 60; jargon in short words scores well, so the review judges level.
  - **Colour** (`colourWarnings`): `focus_colour_off_focus` (an element a beat adds in the focus
    colour that is dimmed the whole beat; one pinned to a reported host is left out) and
    `ok_element_rejected` (a whole-element `reject` on an element drawn `ok`).
  - **`source_missing_on_screen`**: a beat with no `source` whose own board text (not the
    script's items) shows a research number; exempt: `exampleNumbers` beats (the stamp) and
    values an earlier beat of the board cited or said.
  - **`pattern_recently_used`**: past `MAX_RECENT_PATTERN_REUSE` (1), a pattern drawn in this
    video that a recent video used.
  - **`term_shown_late`** (`catalog/term-checks.ts`): a beat's `newTerms` term spoken before the
    board element whose text names it enters (Generator, at the element; entering on the term's
    own words is in time; an element left by an earlier beat or there from the start is shown; a
    pinned one comes with its host), or with nothing on the board naming it (Scriptwriter, at
    `tags`). The headline does not count. Blocking at beginner, advisory otherwise
    (`LEVEL_CODE_POLICY`, `codeSeverity`).
  - **Text size after the camera** (`layout/on-screen-text.ts`, option B): on a chain the layout
    finds `text_too_small`, each beat is measured at board scale × the smallest zoom it holds
    (start framing and `focus` reframings; semantic-zoom pushes left out). The camera only
    zooms in (≥ 1), so this clears beats, never adds any: `text_too_small_on_screen` marks the
    beats still below `MIN_TEXT_PX`. The Generator still checks before the camera.
- **Tests:** seeded faults per check (shared `curator/curator.test.ts`, renderer
  `on-screen-text.test.ts`, `colour-checks.test.ts`, `screen-checks.test.ts`,
  `curator-checks.test.ts`) and the recorded topics (`agents/curator/code-checks.test.ts`, on
  `fixtureGeneratedSpec(topic)`: recorded plan, script and boards with the committed timing).
  The rate limiter raises only `beat_over_target` on beat1 (135%) and beat7 (127%); the
  tokenizer `focus_colour_off_focus` on b5 and b6 and `video_over_target` (112%).
- **The review's input** (`agents/curator/input.ts`, `curatorUserMessage`; the model is text-only):
  NOTES (no chunk ids, no hooks), VIDEO (title, level, lengths, hook and its numbers, running
  example, planted question, rejected alternative, devices, terms with their beats), the
  video-level CODE FINDINGS, then one section per beat: intent and plan, planned vs measured
  length and reading ease, narration, on-screen script text, the research it cites, NUMBERS
  (each number said or shown, screen text whole, with every `num-*` that has its value or "a
  date the notes give": a shared value is not a shared meaning), the BOARD and the beat's code
  findings. A second round adds `· CHANGED` to beat headers and ends with PREVIOUS ISSUES
  (`issue-<n>`) and CHANGED BEATS. Notes first, so a second round reuses the cached prefix.
  Snapshots: `agents/curator/__snapshots__/<topic>.message.txt` (review their diff).
- **Board descriptions** (`describeBoard`, renderer `catalog/board-description.ts`, pure, generic
  over the registries): what earlier beats of the board left on screen, then what this beat adds;
  each item with its screen texts and drawn numbers by prop path (`schema-leaves.ts`), colours,
  icons, refs (pins with their side, connector ends), a pattern's anchors and inner elements,
  this beat's events with the narration word each happens on (index and word as written), and
  its state as the beat ends; the focus over the beat. `reviewBeatTexts` gives the quote checks
  the same texts (narration, headline, tags, stat card values and labels, source line, each
  element's texts and values), so anything the message shows can be quoted.
- **Two passes** (curator@v2): the same system prompt and the same user message up to its last
  sections, `PASS <pass>` and its output shape, so the second call reuses the cached prefix.
  PASS claims (`ClaimsPassSchema`: `claims` and `issues` of `PASS_CATEGORIES.claims`,
  `unsupported_claim` and `number_wrong_meaning`) lists every narration sentence of every beat and
  every element a beat adds that shows a research number (`ReviewBeatTexts.numberLabels`), each
  `supported` with the ids that state it, `no_claim`, or `issue` with an issue quoting it;
  PASS story (`StoryPassSchema`: `issues` of the other categories, `previous` in a second round).
  `reviewPassProblems` (shared `curator/claims-checks.ts`) is each pass's check:
  `curatorIssueProblems`, `category_not_in_pass`, and for claims `claim_missing` /
  `label_claim_missing` (coverage: a repair turn), `quote_not_found` on a claim,
  `claim_ids_missing`, `unknown_research_id` and `claim_issue_missing`.
- **The review's output** (shared `curator/review.ts`): each pass's issues and, in a second
  round, `previous` statuses. Each issue: beat,
  category (`REVIEW_CATEGORIES`), severity, owner, `fields` (`FIX_FIELDS`, each owned by one agent:
  `FIELD_OWNERS`), evidence (narration, headline, tag, stat card or source quotes; a label quote
  with its `elementId`; a fact or number id; a note quote), problem and fix. `CATEGORY_RULES` give
  each category its owners, its severity cap per level and the evidence it needs;
  `capSeverity` lowers a severity past the cap (clarity blocks only at beginner).
- **Verification** (`curatorIssueProblems`, shared `curator/review-checks.ts`, pure, takes any
  JSON; the review's `callJson` check): `unknown_beat`, `quote_not_found` (quotes match
  case-insensitively with typographic quotes and dashes made plain, end punctuation ignored, and
  "..." for words left out, pieces in order), `unknown_element`, `unknown_research_id`,
  `evidence_missing`, `number_not_in_quote` (a `number_wrong_meaning` issue must quote text that
  states its number's value), `owner_not_allowed`, `field_not_owned`, and in a second round
  `previous_status_missing` / `unknown_previous_issue`.

- **`curate` job** (`jobs/curate.ts`, payload `{ specVersionId }`: the re-timed spec after the
  Generator): the code checks on the pinned version (context from the run: the plan's research
  step's notes and sources, series and handle, resolved video settings and pauses,
  `directorMemory` usage, the DB's approved assets), then the two review passes
  (`agents/curator/review.ts`, `reviewSpec`; check `passCheck`, soft on the last attempt), then
  `settleReview` per pass: unverified issues are dropped (`why: unverified`, with the reasons),
  so are issues that repeat a code finding on the same beat (`repeats_code_finding`:
  `hook_retold` over `hook_number_repeated`, `term_before_shown` over `term_shown_late`), and
  severities are capped. A spec that fails validation gets its
  errors and no review. One `run_steps` row per job (stage `curate`):
  `curate/input-<step>.json` (`CurateInputSchema`) and `curate/report-<step>.json`
  (`CuratorReportSchema`: code issues, the review's issues, dropped, capped, the claim audit,
  coverage (repair turns, what stayed out), calls per pass, usage, `blocking`).
  `latestCuration` (`#core/services/curation.ts`) is gate 3's read.
- **Fixture eval** (`agents/curator/fixtures.ts`): per topic `TOPIC_EXPECTATIONS` (must-find,
  may-find, must-not-flag with optional `allowedOwners`), matched by beat, category and evidence
  (an element id or a quote); `CURATOR_SEEDS`, one planted fault per review category
  (`visual_distracts` aside), each a pure edit of the recorded spec (narration edits keep the
  board's word anchors on their words and drop the timing layer). The studio script
  `curator:fixture [--topic] [--seeded <id>] [--replay] [--record] [--timeout <sec>]` runs the
  review (live, or `--replay`; `--timeout` raises `llm.requestTimeoutSec` for that run: the
  passes' reasoning can pass 300 s when the provider is slow) in `<DATA_DIR>/curator/fixture/<topic>[-<seed>]/` and prints the attempts, code findings, every issue with its evidence and fix, what was dropped,
  usage and the eval; `--record` writes `curator.json` and `eval.json` to
  `agents/curator/fixtures/<topic>/responses/` (a seed: `.../<topic>/seeds/<id>/`).
  `jobs/curate.test.ts` replays every recording and expects its recorded eval.

API conventions: routes under `/api`, inputs validated with the `validate()` helper against schemas
from `packages/shared/src/api`, list responses wrapped as `{ items }`, and every error is
`ApiErrorSchema` (`{ error: { code, message, issues? } }`). Domain errors from core
(`NotFoundError`, `RunHasExportsError`) map to statuses in `src/server/errors.ts`. Services that
compose repositories live in `src/core/services`; handlers call them or a repository directly.
Demo and debug endpoints live under `/api/dev` (`src/server/routes/dev.ts`), mounted only outside
the production build (`enableDevRoutes`). There is no generic `POST /api/jobs`: jobs are queued by
the service that owns them.

## Web app

Vue 3 SPA in `src/web`: Vue Router, Pinia, Tailwind v4. Vite serves it in dev and proxies `/api`.

```text
src/web/
  http/          client.ts + one module per resource (runs.ts, dev.ts, health.ts, events.ts)
  public/        static files served at / (favicon.svg)
  composables/   useEventStream, useJobEvents, useRunEvents
  stores/        Pinia setup stores (server state)
  lib/           pure helpers (job-summary.ts, status.ts), unit-tested
  components/    presentational pieces;  views/  one per route
  router.ts      `routes` drives the left nav;  styles.css  theme tokens
  testing.ts     FakeEventSource, stubFetch, makeEvent, makeRun
```

- **No top-level folder under `src/web` may be named `api`.** Vite serves `src/web` as its root,
  so `src/web/api/x.ts` is requested as `/api/x.ts`, which the dev proxy sends to Hono (404, blank
  page). `src/web/layout.test.ts` enforces this.
- **API calls go through `#web/http/client.ts`** (`request`, `postJson`). Every response is parsed
  with its shared Zod schema from `packages/shared`. A non-2xx response throws `ApiRequestError`
  (it carries the parsed `ApiError`). A 2xx response that fails the schema throws
  `ApiContractError`. Show errors with `errorMessage(e)`. Never call `fetch` from a component.
  Endpoint functions are typed by the schemas; no hand-written response interfaces.
- **SSE goes through `useEventStream(filter, { closeWhen })`.**
  - Reactive filter: `null` stays idle, and a change reopens the stream.
  - Listens per event type (the server names messages, so `onmessage` never fires) and parses
    each message with `EventDtoSchema`.
  - Closes on scope dispose. Reconnects come from `EventSource` itself, via `Last-Event-ID`.
  - Use the wrappers:
    - `useJobEvents(jobId)`: full replay of one job, and closes once the job is done or failed.
    - `useRunEvents(runId)`: loads `GET /api/runs/:id`, then streams `?after=<lastEventId>`, so
      a page load never replays history.
- **Pinia stores are setup stores holding server state** (`items`, `loading`, `error`, `load()`)
  that call the API modules. Per-page UI state stays in the component. Folding events into view
  state belongs in pure `lib/` functions (e.g. `summarizeJob`), not in templates.
- **Tailwind v4 tokens live in `@theme`** (no `tailwind.config`). Colour tokens and the mono font
  are generated from the renderer's `blueprint-dark` theme (`STUDIO_THEME_ID`, not the default
  video theme) into `theme.generated.css` by the studio's `gen:theme` script; never edit it by hand (a test fails when it is stale). `styles.css` imports it and adds
  the rest. Tokens: `canvas`/`panel` backgrounds, `line` borders, `ink`/`ink-muted`/`ink-faint`
  text, semantic `focus`/`ok`/`problem`/`concept`, plus the `bg-blueprint` and `label-mono`
  utilities. Use tokens, never raw hex, in components. Series accents are data (`series.accentColour`), not tokens. Class names must
  appear in full in source (e.g. the map in `lib/status.ts`) so the scanner finds them.
- **Tests** stub globals: `stubFetch({ 'GET /api/runs': … })` and `installFakeEventSource()`,
  then `vi.unstubAllGlobals()` in `afterEach`. Mount views with `createPinia()`, and with
  `createAppRouter(createMemoryHistory())` when routing matters. Use `data-testid` for
  selectors.

## Renderer

`packages/renderer`: a Remotion project (`src/entry.ts`, `src/Root.tsx`). From the repo root:
`pnpm --filter @explainer-studio/renderer studio` opens Remotion Studio; `… still:theme` renders
each theme's swatch board to `docs/themes/<theme>.png`; `… still:safe-area` renders the
safe-area overlay to `docs/safe-area/zones.png`; `… still:primitives [ids…]` renders one sheet per
primitive to `docs/primitives/<id>.png`; `… still:patterns [ids…]` renders one sheet per pattern
to `docs/patterns/<id>.png` (a panel per narration anchor, elements in one row per zone);
`… still:layouts` renders `docs/layouts/<mode>-<format>.png` from the layout board;
`… still:pattern-layouts [ids…]` renders `docs/patterns/<id>-layout-<format>.png`: each pattern's
beat through the real layout engine (placement, camera, routing) at its settled moment
(`settledPatternFrame`), in both formats; a pattern whose board params do not suit a format is
drawn with its lighter variant from the script's `FORMAT_VARIANTS` (e.g. `split_brain` without
its lease in card). The per-anchor sheets stay the record of timing. `… still:ending [themeIds…]`
renders `docs/ending/<fixture>-<theme>.png` (`EndingSheet`): each golden fixture's ending card
in both formats at four moments (default theme unless ids are given).

- **Themes** live in `src/theme` and are registered by id (`getTheme`, `listThemes`;
  default `drafting-paper`, a light engineering-drawing look). Each is validated against
  `ThemeSchema`. A theme holds colours
  (semantic `neutral`/`focus`/`ok`/`problem`/`concept`), tint and glow rules, grid, fonts, text
  styles, spacing, radius, stroke widths, safe-area margins and `numberLocale` (on-screen number
  grouping; `en-IN` gives 1,00,000). `tint.fills` overrides a semantic's soft fill (paper's
  focus: ink text on a yellow highlighter); each font role has `advanceEm` for size hints
  (`approxTextWidth`). drafting-paper's display sizes are blueprint-dark's scaled by the
  display `advanceEm` ratio (`scaledText`), so a line holds the same text in both themes
  (`display-fit.test.ts` checks it with real glyph widths). `src/theme` is React-free and
  exported as `@explainer-studio/renderer/theme`, so Node scripts, the layout engine and the
  studio can import it.
- **Theme selection:** `VideoFromSpec`/`BeatFromSpec` take an optional `themeId` (unknown ids
  fail in `calculateMetadata`); `PrimitiveSheet` and `ThemeSwatchBoard` take `themeId`.
  `still:compare [themeIds…] [--only swatch,rate-limiter,<primitive>…]` renders `docs/themes/<theme>.png` and, in `docs/themes/compare/`,
  every primitive sheet plus a mid-video rate-limiter frame per theme.
- **`blueprint-dark` is parked.** It stays registered, selectable via `themeId`, and must keep
  passing typecheck and tests (the per-theme contrast and font-coverage tests run for every
  theme). New primitives are visually reviewed only in the default theme (`still:primitives`);
  check `blueprint-dark` on demand with `still:compare blueprint-dark --only <ids>`. The Studio UI
  tokens are pinned to it (`STUDIO_THEME_ID`), independent of the default video theme.
- **Use the helpers, not raw values:** `tintFor`/`semanticTint` (soft fill, border, glow),
  `semanticFill(theme, semantic, alpha)` for any semantic wash, area or track at a primitive's
  own strength (colour from `tint.fills` when the theme overrides it; never
  `withAlpha(tint.base, …)`), `textCss`, `safeAreas`.
- **Safe areas** come from per-platform exclusion zones (`topBar`, `actions`, `bottomInfo`: rects
  where Shorts/Reels UI covers the video). `safeAreas(theme)` derives a centred HUD band, stage
  and subtitle band from their union, plus `avoidZones` inside the stage that text and key
  elements must stay out of. The stage's top `headlineBand` is reserved only where a headline
  shows: a `continuesPrevious` chain with a headline beat gets `stageWithHeadline` for all its
  beats (`formatAreas`; `stageForBeat` is the per-beat test). Calibrate zones with `calibrate:safe-area <shorts|reels>` against a
  screenshot in `public/calibration/` (gitignored, as are the `docs/safe-area/*-check.png`
  outputs: they show other creators' videos).
- **Series accents are data**, passed in as props, and adapt to the theme: draw them as
  `seriesAccent(theme, stored)` (`theme/accent.ts`: `resolveAccent`, then `accentFor`, which
  moves OKLCH lightness toward the ink until the accent meets `minimumContrast.text` on the
  background; a passing accent comes back unchanged). `SpecLayers` resolves it once, so the top
  bar, step tracker, chapter number and subtitles all get the adapted colour.
  `checkAccentContrast` reports contrast; the swatch board shows stored vs adapted.
- **Fonts** are committed `.woff2` files with their OFL licences in `public/fonts/`, loaded with
  `loadThemeFonts(theme)` (`@remotion/fonts` + `staticFile`). Never load fonts from the network.
  They are subsets of pinned, checksummed sources (`scripts/font-sources.ts`), rebuilt with
  `fonts:subset`. A role's `bundledFallbacks` (Inter) supply glyphs its font lacks (arrows, ✓ ✗,
  ₹); they name other roles or `glyphFallback`, a bundled face that is not a role (Inter in
  `drafting-paper`). Iterate faces with `bundledFonts(theme)`, not `FONT_ROLES`; `src/fonts/font-coverage.test.ts` reads each file's character map and fails when a role's
  stack misses any glyph in `REQUIRED_CODE_POINTS` (`src/fonts/glyphs.ts`).
  **Measuring text:** size hints and the checks measure real glyphs: `approxTextWidth` (size
  hints, `wrappedRows`) is `textWidth` rounded up, and `textWidth` decides whether a line is
  cut off (`src/fonts/measure-text.ts`): real glyph advances from `src/fonts/metrics.generated.json`,
  through the role's fallback stack, case transform and letter spacing, kerning ignored (errs
  slightly wide). Regenerate it with `gen:font-metrics` after `fonts:subset` or a theme font
  change; a test fails when it is stale.
  **Exception: KaTeX.** `formula_card` imports `katex/dist/katex.min.css`, so Remotion's webpack
  bundles KaTeX's own font files from the pinned `katex` package (still never the network);
  `useKatexFonts` delays the render until they load. Do not add other CSS-bundled fonts.
- All `remotion` / `@remotion/*` packages must share one exact version in the catalog.

### Spec compositions

- **`VideoFromSpec`** renders a whole `RenderableVideoSpec`; **`BeatFromSpec`** renders one beat
  (`beatId`), cut from the same global timeline, so its frames match the full video, except that
  a transition into the beat is shown as a cut (the previous board is not drawn). Props are
  plain JSON (`src/compositions/props.ts`): `spec`, `series` (label + accent), `channelHandle`,
  `audioSrc`, `fps`.
  Remotion's `schema` prop is not used (Zod 3 vs 4); `calculateMetadata` validates the spec with
  `validateRenderableVideoSpec`, throws its structured errors, and sets duration and fps.
- **`audioSrc` is a URL** (http(s) or `staticFile()`), never a filesystem path: Remotion renders
  in a browser. `null` renders silently (preview before TTS). The render service always passes
  `null` and muxes the narration with ffmpeg afterwards. `draft: true` draws the "DRAFT" badge.
- **Timing is seconds in the spec, frames only in the renderer.** `effectiveTiming(spec)` and
  `resolveAnchorSec` live in `packages/shared` (the worker needs them too); `src/timing/frames.ts`
  converts to frames at the composition's fps (final 30, draft 15). Without `spec.timing`, timing
  is estimated at 2.6 words/sec. Event frames are always recomputed from word timings; the
  `timing.events` cache is never read. A beat's `endSec` is the end of its narration; silence
  before the next beat's `startSec` (gap, landing hold) keeps its scene on screen, and the video
  ends at `timing.endSec` (else `END_TAIL_SEC` after the last beat). `sceneEndSec(timing, beat)`
  (next beat start or video end) is when a scene leaves the screen: highlights clear by it and
  `draw_cut_short` measures against it.
- Beat `<Sequence>`s tile the video with no gaps (each runs until the next beat starts). A beat
  transition (`events/transitions.ts`: `sceneSpans`, `transitionView`) overlaps the outgoing
  scene's span by `TRANSITION_SEC` (fade, slide, zoom-in, zoom-out); `BeatScene` draws the scene
  through the view, clipped to the board area (HUD, subtitles and audio are untouched). A
  semantic zoom does not overlap: the outgoing camera pushes into `zoomFrom` (focus moves to it)
  over its last `ZOOM_PUSH_SEC`, then it cuts and the new board settles.
- Studio previews both compositions with `fixtures/rate-limiter.json` (no timing layer), and the
  primitive boards `PrimitivesBoard` and `SpatialFlowBoard` (`VideoFromSpec` over
  `fixtures/primitives-board.json` and `fixtures/spatial-flow-board.json`: one beat per primitive
  with every action and part action it supports), plus `InsetRevealBoard`
  (`fixtures/inset-reveal-board.json`). Each board is a valid Short (≤ 90 s), so a new
  batch of primitives gets a new board, listed in `primitiveBoardSpecs` (`fixtures/index.ts`).
  Pattern boards (`PatternFlowBoard`, `PatternDecisionBoard`; `patternBoardSpecs`) have one beat
  per pattern with every anchor, and no scene `layoutMode` (each beat takes its pattern's).
  `LayoutModesBoard` / `LayoutModesBoardCard` (`fixtures/layout-modes-board.json`, the second
  via `withFormat`) have one beat per layout mode, with pins, a ring, a bracket, an inset, a
  footnote and one `continuesPrevious` chain. `TransitionsBoard`
  (`fixtures/transitions-board.json`) has one beat per transition, including the semantic zoom
  from "Redis server" into its "hash table", plus a focus event, held and default highlights, a
  scan, a lock / release and an overlay taking focus. `allFixtureSpecs` lists every fixture spec.
- **Golden fixtures** (`fixtures/golden/`, `goldenFixtures`; Studio: `GoldenRateLimiter`,
  `GoldenStrawberry`) are complete hand-authored Shorts with estimated timing, one per series,
  held to the agent-output bar: no validation or layout warnings in `full`
  (`catalog/golden-fixtures.test.ts`). They are the visual regression set:
  `apps/studio/scripts/golden/golden.visual.ts` (`test:visual`, its own Vitest config, not part
  of `pnpm test`) renders each through the render service (`renderStills` at the default draft
  preset, then `renderDraft`) and compares every beat's still with
  `apps/studio/golden/<fixture>/<beat>.png`: a pixel differs past 24/255 on any channel, an
  image fails past 20 differing pixels (`image-diff.ts`; one changed glyph is ~60). Failures
  write the still and a red diff image to `<DATA_DIR>/visual/<fixture>/`. After an intended
  visual change, refresh with `UPDATE_GOLDEN=1` and review the PNG diff before committing. The
  saved images are macOS renders: same-machine runs are byte-identical, other platforms are not.
  PNGs go through the bundled ffmpeg (`png.ts`: `image2` + `rawvideo`, as the build has no
  `rawvideo` format).
- **HUD** (`src/hud`): top bar, step tracker, hero metric pill, chapter header, story clock and
  headline. Slots come from `hudLayout(theme)` (derived from `safeAreas`); what each part shows at
  a frame comes from pure functions in `hud-state.ts`. Parts are toggled per video in `spec.hud`
  (a part without data is not drawn). The story clock draws its values by unit
  (`heroMetric.storyClock.unit`, `storyClockUnit` in shared; `formatClockValue`): `sec` as a
  clock (m:ss), `count` as a whole number grouped for the theme's `numberLocale`; a clock without
  a unit is a count when a label writes its start or end value ("256 byte values"), else seconds. Chapter header and step tracker default to `auto`, which
  `resolveHud` resolves from `story.devices` (`question_chapters` → header only, else tracker
  only); an explicit true/false is a user override and wins. Every HUD animation starts at a frame
  resolved from a word or beat-edge anchor (`headline.at`, chapter and beat starts).
  **Step tracker** (`StepTracker.tsx`): `StepMarker` draws a dot per step (plus `STEP n/N` in
  the bar style) on the metric row; `StepName` draws only the current step's name on the chapter
  row below, which it shares with nothing but the story clock. With the chapter header on, the
  header takes that row and the name is not drawn. In both styles the metric row holds the step
  marker (or nothing) and the hero metric; the chapter row holds the chapter header or the step
  name and the story clock.
  The theme's `hud.style` picks how the same data is drawn (`Hud` dispatches; `useHudModel` is
  shared): `bar` (blueprint-dark, `BarHud`) or `title-block` (drafting-paper, `TitleBlockHud`):
  a ruled title block (`SERIES · TOPIC` over `SHEET n/N | REV A | handle`; SHEET is the step
  tracker's label), the step dots beside the hero metric as a dimension (`DimensionMetric`), then
  the chapter header (or the step name) beside the story clock; rows `xs` apart so they fit the
  HUD band. Its slots come from `titleBlockLayout(theme, variant)`. `TitleBlock` has a
  `header` variant (the title in display type over the cells): with `meta.format: "card"`, `Hud`
  draws it in every theme, with the same chapter / metric and clock rows, in the card header
  region (`formatAreas`); the headline goes under the window. `CardViewport` draws the window as
  a ruled viewport (thin ink border, a label cell top-left: the chapter name while the chapter
  header is on, else `DETAIL A`); the board sits inside it, below the cell (`viewportBoard`). `still:compare` renders it as the
  `rate-limiter-card` target.
  - **HUD text never truncates silently.** Every HUD text that can be cut (ellipsis or line
    clamp) has a pure slot width (`hud-slots.ts`: `barSlots`, `titleBlockSlots`): its row less
    the measured width (`textWidth`) of what shares the row (dimension, story clock at its
    widest point value, handle). Components cap the text at that slot (`maxWidth`;
    the text itself is `flex: none`, except the chapter header, which stays `flex: 1` so its box
    does not clip the last glyph's antialiasing), and `hudTextWarnings(spec, theme, { seriesLabel,
channelHandle })` measures the same strings (`subjectText`, `chapterHeaderText`, the step
    name) against the same slots: `text_truncated` at `$.meta.title` (top bar,
    strip subject, card header title in `TITLE_LINES`), `$.story.chapters[i].question|title`
    (chapter header, step name, card viewport label) and
    `$.script[i].headline.text` (`HEADLINE_LINES`, greedy wrap at spaces: `wrapText`). The run
    context is required (the series label and handle are not in the spec); the Curator runs it
    next to `specLayoutWarnings`. A new HUD text that can be cut needs a slot and a check.
    Every `text_truncated` message (HUD and layout) states its room in px and about how many
    characters fit (`describeRoom` / `roomInChars` in `src/fonts/measure-text.ts`, from the
    style's real advances over a sample phrase), so a model can act on it. When something shares
    the text's row (the handle, the story clock: `RowShare`s on `barSlots` / `titleBlockSlots`,
    the same list the slot is computed from), the message names each and the px it uses. The
    hero metric is checked against its row too (`metric` slot: the row less the step marker and
    the pill or dimension chrome), at `$.story.heroMetric`: it is drawn whole, so too long runs
    into the marker.
    `CHAPTER_TITLE_MAX_CHARS` (shared; in the chapter title's schema description) is what the
    narrowest chapter-title slot of the default theme holds (the card viewport label); a test
    recomputes it. `HERO_METRIC_MAX_CHARS` (label and value together; in their schema
    descriptions) is what the default theme's metric row holds beside a 5-step marker, and
    `TITLE_MAX_CHARS` what its subject line holds after the longest seeded series label; tests
    recompute both. The Director's title hint is per series: `titleRoomChars(theme, label)`
    (`hud/title-room.ts`, the same slots `hudTextWarnings` measures: 44 after "SYSTEM DESIGN · ",
    55 after "AI · ") goes into `DirectorInput.titleMaxChars` and the user message's `title` line.
- **Ending card** (`src/ending`): drawn by code from `story.ending` (spec card lines, the series
  label with `#<seriesNumber>`, the CTA), like the headline and footnote; agents never place it.
  It shows when the ending has lines or a CTA (`hasEndingCard`), enters on the first word of the
  final beat's last sentence (`endingStartSec`, `sentenceStartIndexes` in shared; without word
  timings `ENDING_FALLBACK_SEC` (2.5 s) before the beat's narration ends) and holds through the
  end tail. While it shows the board layer dims by `DIM_FADE` (`endingBoardOpacity`) and the
  headline stops (`cuesUntil`). Geometry is pure (`ending-layout.ts`): over the board, clear of
  avoid zones (`endingRegion`), fixed row heights (header cell; one `chapter`-style line per spec
  card line beside its number; the CTA in `body`, up to `ENDING_CTA_LINES` (3)). Title-block
  themes draw a ruled table that draws on with the pen over `ENDING_DRAW_SEC`; bar themes a plain
  raised card that fades in. `hudTextWarnings` checks both texts (`text_truncated` at
  `$.story.ending.specCard.lines[i]` and `$.story.ending.cta`). `beatKeyFrame` keeps the final
  beat's still before the card.
- **Subtitles** (`src/subtitles`): word-by-word karaoke captions in the format's
  `subtitleBand` (`formatAreas`; card has its own). `buildSubtitleCues(spec, theme)` (pure,
  exported through `catalog`) is the single source for the burned-in captions and the SRT.
  Cues are one line of at most `MAX_CUE_WORDS` (4) words, never spanning two beats, split
  (`chunking.ts`) at pauses longer than `PAUSE_BREAK_SEC` (0.25 s, on the speech-trimmed word
  timings), then after sentence and clause punctuation (a lone word joins a neighbour), then by
  cost: few chunks of about 3 words, none ending on a word that leans on the next (articles,
  prepositions, conjunctions, a number before "thousand"), each fitting the band by `textWidth`.
  A cue shows from its first word to its last word's end + `CUE_LINGER_SEC`, clamped to the
  next cue and the scene end. Words are the narration tokens as written ("JSON"), never TTS
  respellings, placed at measured offsets so the line never reflows. Glow themes draw the
  current word in the series accent; mark themes keep ink and slide the `FocusUnderline` band
  (`underlineBandCss`) under it over `WORD_SLIDE_SEC` (80 ms). Nothing is cut: a word wider
  than the band gets its own cue drawn scaled down, and `subtitleWarnings` reports
  `subtitle_word_too_wide` at `$.script[i].narration` (the Curator runs it with the HUD and
  layout checks).
- **Scene layer** (`src/scene`): `beatWorld` (pure) collects a beat's elements, expanded
  patterns and everything inherited through `continuesPrevious`, each with the events that act on
  it (resolved by the event engine, below) and its focus keys; `BeatScene` draws them with their registered components (through `WorldItemView`, which
  the primitive sheets share). Unknown ids and invalid props are drawn as red, hatched error
  markers, never as content. Placement comes from the layout engine (`specLayout`, below):
  each item at its placed rect, drawn in its own box px and scaled, under the beat's camera.
  - **Overlays** (`layer: 'overlay'`: `inset_panel`, `statement_card`) are placed centred in
    the board frame above it (`scene-layers.ts`: `splitLayers`). While one shows, focus moves to
    it and its children and the board dims through each element's `dimmed` (the focus track);
    there is no scrim layer. At most one should show at a time (`overlay_overlap`).
  - **Containers:** elements a primitive points to with a `contains` element ref (an
    `inset_panel`'s `children`) are nested under it by `beatWorld` and drawn inside it, never
    focus-dimmed with the board. A child's presence is multiplied by its container's (`containedState`), so it
    enters and exits with it; it keeps its own events.
  - **EXAMPLE stamp** (`scene/example-stamp.ts`, `ExampleStamp.tsx`): on a beat whose plan
    marks `exampleNumbers`, code draws a small "EXAMPLE" stamp (title-block themes: a ruled box in
    muted ink; bar themes: a soft pill), fading in with the footnote. It sits right-aligned in a
    band the layout reserves at the top of the board frame for every chain with such a beat
    (`ChainLayout.stamp`), left of any avoid zone in the band, so it never covers the board;
    labels need no "e.g." of their own.
  - **Source footnote:** a beat's `script[].source` is drawn as "Source: …" in the footnote
    style at the board frame's bottom-left (`source-footnote.ts`), fading in 0.3 s after the beat
    starts. The layout reserves its line for the whole chain when any beat in it has a source
    (`footnoteLine`). Required whenever a beat shows a real incident or a sourced number (agent
    prompts enforce it). `SOURCE_MAX_LENGTH` (58) is what fits after "Source: " on the narrowest
    footnote line of any theme and format at the footnote style's average advance (a test
    recomputes it); a shorter line of wide glyphs can still be cut, which warns
    `text_truncated`.
- **Layout engine** (`src/layout`, React-free, exported through `catalog`):
  `layout({ items, mode, focus }, theme, { rect, avoidZones })` places one board; `specLayout(spec,
theme)` lays out a whole spec, memoised per spec object and theme (never per frame) and
  deterministic. Pipeline: `analyse` (units = elements with their pins as one cluster; links =
  connectors) → the mode's `place` (from `LAYOUT_MODE_DEFINITIONS`, composed from `blocks.ts`) →
  `separate` → followers (`relations.ts`) → `fit` (one board scale ≤ 1, centred).
  - **One placement per `continuesPrevious` chain** (over all its elements), so continuing beats
    keep every position; mode and focus come from the chain (a continuing scene's own mode is
    ignored with `layout_mode_ignored`). **Each chain gets a camera track** (`camera.ts`,
    `camera-track.ts`): a uniform zoom (1 to `MAX_ZOOM` 1.6) and pan of the board layer framing
    the elements visible in each beat, biased to its focus, kept in frame and clear of avoid
    zones; a key at each beat start (the chain's first settled, later ones easing over
    `CAMERA_EASE_SEC`) and at each `focus` event, plus a semantic-zoom push (`zoomCamera`, past
    filling the frame). `BeatScene` reads `cameraAt(track, sec)` in global seconds.
  - **Frames are parameters** (`formatAreas(theme, format)`): `full` = the stage (or
    `stageWithHeadline`); `card` = a 16:9 window under the header region, clear of every
    exclusion zone (narrowed if needed). Avoid zones are hard: a board that hits one is slid out
    or re-arranged beside / above it. Modes pick orientation from the frame (pipeline top-down in
    tall frames, left-right in wide), and the fit keeps the other orientation if it is clearly
    larger.
  - **Sizes:** preferred size hints at board scale; focus elements and `center`/`hub` zones ×1.2
    (`FOCUS_BOOST`). Below 18 px labels (`minReadableScale`) a board gets `text_too_small`.
  - **Primitive hooks** (registry data, no id switches): `layoutRole` (`background` map_base;
    `path` connector, packet_stream; `frame` grid_overlay; `ring` radius_ring; `span` bracket) and
    `contentInset` (containers size from their children and lay them out in their own box:
    `PlacedItem.children`), and `textRects` (text drawn outside the body, e.g. a ring's rim
    label; the layout warns `text_covered` when an element covers it), and `clippedLines` (lines
    drawn on one line and cut off, by ellipsis or clip, past a room computed from the box:
    `node_card` subtitle, `data_block` fields, `segmented_time_bar` labels; the component cuts
    at the same room function). A `radius_ring` grows to
    enclose its `encloses` elements and their side pins. Relational components get `path` (box px, layout output) and draw
    `standalonePath` only on sheets.
  - **Connector routing** (`routing.ts`): a connector stays a straight edge-to-edge line when it
    crosses no element or pin box; otherwise it takes the shortest orthogonal candidate that
    crosses nothing (straight orthogonal, two L-shapes, Z-shapes through every channel between box
    edges and around the outside; each bend costs 40 px, ties keep candidate order), with rounded
    corners. Followers are placed twice so routes also avoid midpoint pins. `packet_stream` reuses
    the route; midpoint pins sit beside the middle of the segment holding its midpoint (the free
    side). `connector_crosses` means no candidate cleared.
  - **Mode details:** `centered_focus` and `hub_spoke` put the others above and below the
    middle in a tall frame (beside it in a wide one), all on the free side when only one of the
    middle's top and bottom holds pins; only when a link joins the middle to them and its pins
    sit on one axis do they take the other axis (`arrangement`). `stacked_list` puts the link gap (room for a label or midpoint pin)
    between two rows a link joins, the plain gap elsewhere; each `versus_split` half lists the
    units a link from the shared row reaches first, so no route from the shared row crosses a
    unit above them; a zone-less stat card in `versus_split` goes in the shared row.
  - **Room warnings say what to change:** `text_too_small` names the widest units at full size
    and what is pinned to their sides (`roomTakers`); on a continuing beat, `text_too_small` and
    `too_many_elements` in an earlier beat of its board say only its additions can change, and
    that pinned elements are not counted as elements.
  - **Pins:** `tag`, `counter`, `timer_ring` and `callout` take `pin: { to, side }` (`top`,
    `bottom`, `left`, `right`, or `middle` of a connector: beside its midpoint). The layout keeps
    them on that side of their host wherever it goes; unresolved pins get `pin_unresolved`.
  - **Warnings** (`LayoutWarning`; `specLayoutWarnings(spec, theme)` gives `{ path, code,
message }` for the Curator): `too_many_elements` (mode `maxUnits`), `text_too_small`,
    `overlap`, `connector_crosses`, `text_covered`, `unknown_zone`, `unknown_layout_mode`, `layout_mode_ignored`,
    `pin_unresolved`, `avoid_zone`, and `text_truncated` (`text-fit.ts`: a `clippedLines` line
    wider than its room at the placed box, container children included, or a beat source wider
    than its chain's footnote line; measured with `textWidth`; the path points at the text
    itself, e.g. `$.scenes[3].elements[1].props.subtitle` or `$.script[1].source`, or at the
    pattern instance). Never truncate text silently: a primitive that cuts text must declare
    `clippedLines` (HUD text: `hudTextWarnings`, see HUD). Tests run the invariants (no
    overlaps, inside the frame, clear of avoid zones, camera bounds, no `text_truncated`) over
    every fixture beat in both formats.
- **`src/dev/` is for temporary stand-ins** (none today). `src/dev/dev-layers.test.ts` keeps the
  replaced ones (`DevBeatPreview`, `DevSubtitles`) from coming back.

### Primitives and patterns

- **Registries:** `src/primitives/registry.ts` (`PRIMITIVE_DEFINITIONS`) and
  `src/patterns/registry.ts` (`PATTERN_DEFINITIONS`). Catalogues, prompts and
  validation read only from them. They are React-free and exported, with validation and the
  catalogue builders, as `@explainer-studio/renderer/catalog` for the worker and server.
- **A primitive** is `primitives/<id>/definition.ts` (`definePrimitive`: id, family, strict Zod
  props schema, supported actions, `sizeHints(props, theme)`, LLM description with summary, when
  to use and when not to, one example, `assetRefs(props)` if it references assets,
  `elementRefs(props)` if it points to other elements, and `parts` if events can address its
  parts) plus its
  component, wired in `primitives/components.ts` (typecheck fails when a registered id has no
  component). Building the registry rejects duplicate or non-slug ids and examples that fail their
  schema. Every primitive needs a beat on exactly one primitive board using each action and part
  action it supports (a test enforces it; `exit`, `recover` and `release` once per board), and a sheet in `docs/primitives/`
  (`still:primitives <id>`; sheets shrink their panels to fit up to 10 events).
- **Shared pieces:** `common-props.ts` (semantic, asset id, one-line text, part list and element
  ref schemas; screen text (`lineText`, `screenString`) is trimmed, except that `beatWorld`
  first shows a leading or trailing space as "␣" (`showEdgeSpaces`, U+2423, a required glyph)
  when the beat's script has that exact text with the space, in a tag or a narration quote
  (`scene/edge-spaces.ts`: `scriptEdgeTexts`, `withScriptEdgeSpaces`), so the tokenizer's
  " Paris" stays distinct from "Paris" while an accidental "Shared store " is trimmed), `surface.ts` (card surface), `badge.tsx` (corner badge; `SMALL_BADGE` on small
  cards), `motion.ts` (reject shake), `typing.ts` (typing rates), `geometry.ts` (polylines,
  arrowheads, `smoothstep`, `catmullRom`), `overlay.ts` (`riseView`, `zoomView`, `growView`
  entrances), `reveal.ts` (lines that draw on `enter` instead of fading in) and
  `svg-marks.tsx` (cross and pin marks). Prefer them over per-primitive copies.
- **Enter style goes through `src/draw`, never per primitive.** The theme picks `enter.style`:
  `fade` (blueprint-dark: the usual fade and grow-in) or `draw` (drafting-paper). With `draw`,
  `beatWorld` (given `{ theme }`, and on boards the placed layout) runs `events/draw-order.ts`:
  every whole-element `enter` becomes a draw (`ElementEvent.drawSec`: outline length at
  `PEN_SPEED_PX_PER_SEC`, clamped to `DRAW_MIN_SEC`–`DRAW_MAX_SEC`), after stagger and scans; a
  follower (pinned, contained, or a `follows` element ref such as `packet_stream.along`) enters
  at max(its own enter, its host's draw end), or at that end when it has no enter of its own. A
  draw enter is present at once and exposes `state.draw` (`stroke`, then `fill`). The one shared
  layer, `DrawReveal` in `WorldItemView`, strokes the primitive's `outline(props, box, theme)`
  shapes on (dash offset) and fades the component in with `fill`; without an outline it fades
  in with `progress`; lines (`layoutRole: 'path'`) draw themselves via `revealState`. Outlines
  trace the CSS border exactly (`borderOutline`: inset by half the width, radius less half;
  cards use `cardOutline` next to `cardSurfaceCss`), and the layer is gone once the draw ends,
  so a settled frame is identical to the fade style (`draw.test.tsx`). Parts keep the fade. The
  title block and card viewport draw on once from frame 0 over `HUD_DRAW_SEC` (`hudDraw`,
  `DrawOutline`, `DrawRule`). Sheets move a panel to the latest draw end before the next
  moment (`settleDraws`).
- **Emphasis goes through `src/emphasis`, never per primitive.** The theme picks
  `emphasis.style`: `glow` (blueprint-dark) or `mark` (drafting-paper: a highlighter swipe in the
  focus fill, outlines and lines regular → bold while highlighted, an ink ripple on pulse).
  Components use `emphasisShadow`/`emphasisFilter` (glow), `emphasisStroke`/`emphasisLineWidth`
  (outline and line widths), and draw `BoxMark` (first child of an element styled with
  `markHostCss`), `LineMark` (under an SVG line) or `PointMark` (behind an SVG marker) with
  `markLevels(state)`. Cards and spatial containers pass `size` to `BoxMark`: above
  `MARK_FRAME_MIN` (360 px on either side) a highlight draws a frame band along the border
  instead of a full swipe; text-like elements (counter, tag, icon) always get the swipe. A
  `reject` ends a held highlight on that element or part (`elementState`), in every theme. All of them are no-ops in glow themes, so blueprint-dark output stays
  byte-identical. `EMPHASIS_THRESHOLD` decides "is emphasised" for label colours and z-order.
  Text or numbers drawn in `semantic: focus` (counter, counter_transition, stat_card value,
  timer_ring time, hero metric, story clock, focus headline) wrap their text in
  `FocusUnderline`: in mark themes a resting highlighter band behind the lower 45% of the text
  (`wrap` for text that breaks across lines), replaced by the swipe while highlighted (pass
  `highlight={state.highlight}`); it renders the bare text in glow themes.
  Glows that are not emphasis (packets, the route line, tags) stay plain `tint.glow*`.
- **Descriptions name only registered ids**, in backticks (a test checks that every backticked
  word is a registered primitive, an action, a part action or a prop). Example strings use
  `<example-…>` placeholders; ids that must be slugs (part ids, element refs) use
  `example-…`.
- **Example text is invented.** Fixture text (narration, labels, names, ids, sources) and
  catalogue text (descriptions, param hints, examples) is made up for this project, never taken
  from the reference breakdowns or their videos (no scenarios, names, labels or numbers lifted
  from them; see Originality in the design doc). Agents read the catalogue and copy from it.
- **Components receive only `{ theme, props, box, state }`** (plus `path` for relational ones,
  `children` for containers), never events or anchors. `state`
  comes from `elementState(events, frame, fps, focus)` (`primitives/element-state.ts`): `presence`,
  `emphasis` (held highlight or pulse bump), `highlight` (the held highlight alone), `dimmed`, per-action `actions[action]` progress and `elapsed[action]` seconds (both
  0 while the element's first such event is still ahead, absent when it has none),
  `runSec[action]` (below), `starts[action]` (how many occurrences have started, for components
  that step once per occurrence) and `parts` (below). It is the single place events become state.
  An element is present from the start unless its first `enter`/`exit` is an `enter`, so it can
  exit and re-enter.
- **Event engine** (`src/events`, React-free). `presets.ts` holds every timing and strength
  constant: per-action duration and easing (none overshoots), group stagger, highlight lead,
  camera and transition times, and `DIM_FADE`, the one dim strength (components use
  `dimOpacity(state.dimmed)`, never a literal). `resolve.ts` turns anchored scene and pattern
  events into per-element events: a default stagger for groups (several targets, an instance,
  several parts; enter, exit, highlight, dim, pulse), `params.stagger: 'scan'` for a one-by-one
  sweep (any action; parts in the element's own order; ≤ 2 s and never past the beat's next
  event), a highlight 0.2 s before its word that clears by the time its scene leaves the screen
  (`AnchoredEvent.sceneEndSec`, so it stays on through a gap or landing hold) or the next focus
  change (`untilSec`) unless `params.hold`. `focus.ts` is the focus track: the beat's `focus`,
  `focus` events (an engine action, valid on any target; never delivered to elements) and
  overlays give each element a focus track (`focus` and `overlay` keys); out of focus means
  `dimmed`, lifted while the element is highlighted, but the overlay dim is never lifted.
  Followers (pinned, contained) share their host's focus. `params.ts` reads and validates
  `hold` / `stagger` (`invalid_event_param`: `hold` off a highlight).
- **Fail → recover.** A `reject` is held until a later `recover` on the same element or part;
  nothing else ends it (highlight, enter and pulse leave it red; lock is separate). Once a
  recover starts, `actions.reject` reads 0, so components drop their problem look without code
  of their own, and the element plays a short settle bump (emphasis; a ripple in mark themes via
  `markLevels`) in its own colour. `definePrimitive` adds `recover` wherever `reject` is
  supported (`withEndings`, element and parts); definitions never list it. Boards exercise it once
  per board, like `exit`.
- **Lock → release.** The same rules for `lock`: held until a later `release` on the same
  element or part (only that ends it), which fades `actions.lock` back to 0 with the same settle
  bump. `withEndings` adds `release` wherever `lock` is supported. `recover_without_reject` and
  `release_without_lock` warn on an ending with nothing held before it.
- **Parts.** A primitive with `parts: { actions, ids(props) }` (slots, cells, zones, queue
  items, route stops, time segments) lets an event act on named parts: `params.parts: [<id>…]`
  with exactly one target. Those events drive only `state.parts[id]` (read it with
  `partState(state, id)`, `IDLE_STATE` when no event names the part), under the same rules as the
  whole element; the other events drive the element. Verbs map to existing actions, never new
  ones: pick/take → `exit` on the part, put back → `enter`, claim → `lock`, free → `release`,
  turn red → `reject`, back to normal → `recover`,
  change state (a button's label, a jumpy route smoothing) → `morph`. Optional parts work too: a
  `node_card` with a `role` has the part `role` (move a role: `exit` it on the old holder, `enter`
  it on the new one); a primitive whose `ids(props)` is empty has no parts to address. The
  catalogue lists `partActions`.
- **Element refs.** Props that point to other elements (`connector.from/to`,
  `packet_stream.along`, `grid_overlay.over`) are declared by `elementRefs(props)`, optionally
  limited to certain primitives, to some of the target's `parts` (`bracket.parts`), marked
  `contains` (drawn inside this element; see Containers), a `pin` side (see Layout engine), or
  `follows` (it draws only after the target has, in the `draw` enter style). The layout engine
  turns them into geometry.
- **`elapsed` is measured on the global timeline**: `frame / fps` minus the event's unrounded
  resolved seconds (`ElementEvent.sec`), so a beat cut, a draft (15 fps) and the final (30 fps)
  agree, including for actions that started in an earlier beat. Effects that outlast an action's
  fixed duration use it at fixed, capped rates that never depend on beat length (`typing.ts`:
  `command_bubble` ~30 chars/s capped at 1.5 s, `data_block` 0.35 s per field; a `connector`
  packet takes 0.9 s, a `packet_stream` packet 1.2 s, `route_path` draws in 1.5 s,
  `segmented_time_bar` fills 0.35 s per segment capped at 1.5 s). Only
  `timer_ring` (and a `ticking` `counter`, below) runs for narration time: `count` starts it, and its speed is derived, never
  authored (`durationSec / runSec.count`, at least 1), so it reaches 00:00 exactly on the
  `reject` word (expiry, red flash) or, without one, at the element's `exit` or the end of the
  beat, where it holds 00:00. A "⏩ N×" tag shows from `count` on (fading in like an `enter`) when it runs faster
  than real time. A `counter` with `ticking: true` runs the same way (`tickProgress`: linear over
  `runSec.count`, landing on `value` at its `reject`), for clocks that count up (an outage).
  Every visible change comes from an event.
- **`runSec[action]`** (`actionRunSec`) is how long an occurrence runs, from resolved event
  times: until the element's next `reject`; without one, until its next `exit` or the end of the
  beat it is anchored in (`ElementEvent.beatEndSec`), whichever comes first.
- **Assets** (`src/assets`; style rules in `docs/asset-style.md`). Asset ids in props are
  slugs, not enums, so unknown ids are warnings (`unknown_asset`), never schema errors. The
  warning suggests up to 6 closest approved ids (`suggestAssets`: deterministic token, id
  coverage and bigram score over id, name and tags; the family an `AssetRef` implies ranks
  first), only real matches and never the whole list; with none it says "No close match"
  (`NO_CLOSE_ASSET`).
  - **House SVG** (`house-svg.ts`): one `<svg>` with a 24×24 viewBox and a flat list of shapes
    (`AssetShapeSchema` in `packages/shared`: geometry attributes plus the palette tokens
    `currentColor` and `var(--asset-fill)`). `parseHouseSvg` rejects anything else (no
    sanitising; that is P1C.12); the renderer draws the parsed shapes, never raw markup, and sets
    stroke width, round caps and joins itself. Bump `HOUSE_STYLE_VERSION` when the rules change.
  - **Library:** the `assets` table (approved rows) plus `<DATA_DIR>/assets/<id>.svg`. The seed
    set (`seed.ts`: curated Lucide icons, canonical export names, ISC or ISC AND MIT for icons
    Lucide derived from Feather, `LICENSE-lucide.txt`) is copied in by `prepareDatabase`
    (`db:migrate`), idempotently; it refreshes only rows it seeded. Families are the closed
    `ASSET_FAMILIES`; `logo_` ids are reserved for logo slots. `gen:catalogue` lists the seed ids
    by family.
  - **Renders get assets as props** (`assets: ResolvedAsset[]`, validated in
    `calculateMetadata`): the worker resolves them with `prepareRenderAssets`
    (`#core/assets/render-assets.ts`); without the prop the seed library is used (Studio,
    stills). `SpecLayers` provides them through `AssetProvider`; `AssetGlyph` draws library
    shapes, a logo file, or a neutral placeholder showing a readable label.
  - **Logo slots:** `spec.logos` (`logo_<slug>` + label, a run setting outside the LLM schema)
    are used like asset ids and filled by the user's file in `runs/<id>/logos/<slot>.svg|png`
    (≤ 300 KB, ≤ 1024 px, checked on load; never fetched), drawn as an image in its own
    colours. Unfilled slots are draft-only placeholders.
  - **Missing assets:** `missingAssets(spec, assetContext(...))` lists unknown ids and unfilled
    slots with their beats and paths (the same walk as `unknown_asset`: `catalog/asset-uses.ts`);
    `recordMissingAssets` merges each render's list per beat into
    `runs/<id>/missing-assets.json`.
- **A pattern** is `patterns/<id>/definition.ts` (`definePattern`): the primitive shape minus
  component and size hints, plus `anchors` (the narration moments it needs, some `optional`),
  `layoutMode`, `targets` (its inner elements, documented for the catalogue; `worker-<n>` for list
  params, counted from 1) and `expand(params) → { elements, events }`. Shared builders are in
  `patterns/build.ts`.
  - `params.at` holds one `EventAnchor` per anchor (`anchorsSchema(ANCHORS)`), and every event
    the expansion makes is anchored to one of them. Param text limits match the primitive the text
    lands in, so valid params always expand into valid props.
  - The pattern stages its own entrances. Spec events on the instance may use only its `actions`
    (from `PATTERN_INSTANCE_ACTIONS`: exit, highlight, dim, pulse; they act on every element).
    Spec events may target one inner element as `<instance>/<id>` with `INNER_TARGET_ACTIONS`
    only (highlight, pulse, dim). The pattern keeps enter, reject and lock.
  - **Layout:** `layoutMode` comes from `src/layout/modes.ts` (`LAYOUT_MODE_DEFINITIONS`, each
    with its allowed zones). Every expanded element sits in a zone of that mode, except ones with
    element refs (relational, pinned), which follow what they point to. A beat without its own
    `layoutMode` takes its first pattern's (`beatLayoutMode`); an explicit scene mode wins. Do not
    add modes for a pattern: pick the closest (pin what belongs to another element) and note
    the loose fit in docs/TODO.md.
  - **Formats:** each pattern declares `formats` (the `meta.format`s its board reads well in,
    from measured board scale) and optionally a `formatRule` that narrows them by params (e.g.
    `worker_pool` with more than 2 workers: full only). Validation warns
    `pattern_format_mismatch`; the catalogue lists both, so the Director can choose the format.
  - Building the registry expands each example and rejects (`expansionProblems`): unknown
    primitives, bad props, duplicate ids, zones outside the mode, element refs that leave the
    expansion, unsupported actions or bad parts on events, events not anchored to `params.at`, and
    inner elements missing from `targets`. Instance actions outside `PATTERN_INSTANCE_ACTIONS`
    are rejected too.
  - The scene layer namespaces expanded elements as `<instance>/<id>`, element refs in their
    props included, and keeps each element's `zone` on its world item.
- **Validation:** `withRegistryChecks(validateVideoSpec(input), input)` (or with
  `validateRenderableVideoSpec`) adds registry errors in the same `{ path, code, message }` shape:
  `unknown_reference` for unknown primitive/pattern/layout mode ids (the message lists valid ids), Zod issue
  codes for props/params with paths into them, and `unsupported_action` for an event action a
  target (including one inherited through `continuesPrevious`) does not support. For
  `params.parts`: `unknown_part` (unknown id, or a target without parts), `parts_need_one_target`,
  and `unsupported_action` at the event's `action` when the parts do not support it. For element
  refs: `unknown_element` (not in the beat's scope), `invalid_element_ref` (itself, the wrong
  primitive, a pin to a pattern instance (it names the board's own pin hosts), an overlay put
  in a container, or an element already in another container) and
  `unknown_part` (a ref's parts). It also adds **warnings** (the spec stays valid, Studio shows
  them, agent output repairs them since warnings count as failures there): `unknown_asset` for
  asset ids (from `assetRefs`) that are neither in the asset registry nor a declared logo slot
  (a placeholder is drawn), and
  timeline warnings (`catalog/timeline-checks.ts`, from real or estimated timing):
  `overlay_overlap` (two overlays visible at once), `child_before_container` (a contained
  child's event before its container enters), `recover_without_reject` /
  `release_without_lock` (an ending with no reject / lock held on that element or part),
  `scan_too_short` (a scan's resolved step below `SCAN_MIN_STEP_SEC`, squeezed by the beat's
  next event: `catalog/scan-checks.ts`), `draw_cut_short` (an enter whose draw or fade would
  not finish before its scene leaves the screen, unless the next beat continues the chain with
  it still present; measured on the world as `BeatScene` renders it, `renderedWorld`, in the
  default video theme: `catalog/draw-checks.ts`) and
  each primitive's own `eventWarnings(props,
events)` (`route_moves_exceed_stops`: a jumpy `route_path` with more `move`s than hops;
  `morph_without_change`: a `device_frame` morph without `button.then`).
  Pattern instances (`catalog/pattern-checks.ts`): params against the schema,
  `invalid_pattern_expansion` (a safety net), `anchor_out_of_range` for `params.at`,
  `unknown_reference` for an `<instance>/<id>` that is not in the expansion, and warnings
  `unknown_asset` (assets inside the expansion) and `pattern_layout_conflict` (two patterns in a
  beat with different modes while the scene sets none).
- **LaTeX** (`formula_card`) is validated by rendering it with KaTeX in the props schema
  (`latexProblem`: parse errors, refused commands such as `\href`, `maxSize`, `maxExpand`, at
  most 80 characters), so a formula that passes validation always renders.
- **Catalogue:** `pnpm --filter @explainer-studio/renderer gen:catalogue` writes
  `docs/catalogue.md` and `docs/catalogue.json` (LLM-facing fields only, props as input-side JSON
  Schema, no size hints). A test fails when either is stale. Prompts build theirs at runtime with
  `buildCatalogue()`.

## Code conventions

- TypeScript strict everywhere (`strict`, `noUncheckedIndexedAccess`). Shared base:
  `tsconfig.base.json`.
- Keep functions small and single-purpose. Keep pure logic apart from I/O so it can be unit-tested
  (e.g. `parseConfig` vs `loadConfig`).
- Imports use explicit `.ts` / `.vue` extensions.
- Path aliases are Node subpath imports declared in `apps/studio/package.json`: `#core/*`,
  `#server/*`, `#worker/*`, `#web/*`. Cross-package imports use workspace names
  (`@explainer-studio/shared`). Do not add tsconfig `paths`.
- Workspace packages export TS source (`exports` → `src/index.ts`); there is no build step for them.
  `packages/shared` must stay free of `node:` imports because the browser bundle imports it.
- Tests are co-located (`*.test.ts`) and use Vitest. Studio has two Vitest projects: `node` (core,
  server, worker) and `web` (jsdom).
- Dependency versions live in the pnpm `catalog:` in `pnpm-workspace.yaml`. Add new deps there.
  Respect pnpm's `minimumReleaseAge`; do not add exclusions to bypass it.
- Env lives in a `.env` at the repo root (see `.env.example`). It is loaded by `#core/config.ts`.
  Relative `DATA_DIR` paths resolve from the repo root.

## Rules for this task

- Read CLAUDE.md first and follow it.
- Plan before coding; list the files you will create or change.
- Keep changes to this task's scope. Note follow-ups in docs/TODO.md instead of doing them.
- Add or update tests for logic you write (Vitest). Run typecheck, lint and tests before finishing.
- Finish with a short summary: what changed, how to verify, any open questions.
