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
packages/shared/        Zod schemas, catalogues, inferred types (consumed as TS source)
packages/renderer/      Remotion compositions (React) and the theme system (see "Renderer")
data/                   runtime data: SQLite DB, runs/, topics/, assets/, exports/ (gitignored)
docs/TODO.md            follow-ups logged instead of done
```

Prerequisites: `nvm use` (Node 24, from `.nvmrc`), then `corepack enable pnpm` so `pnpm` resolves to
the version pinned in `packageManager`. Re-run it after switching Node versions; do not install pnpm
globally.

Commands (from the repo root): `pnpm dev` (server, worker and Vite via `concurrently`),
`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`.

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
to `docs/patterns/<id>.png` (a panel per narration anchor, elements in one row per zone).

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
  elements must stay out of. The stage's top `headlineBand` is reserved only on beats that show
  a headline: such a beat's board gets `stageWithHeadline` (`stageForBeat(areas, spec, beatId)`). Calibrate zones with `calibrate:safe-area <shorts|reels>` against a
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
  **Exception: KaTeX.** `formula_card` imports `katex/dist/katex.min.css`, so Remotion's webpack
  bundles KaTeX's own font files from the pinned `katex` package (still never the network);
  `useKatexFonts` delays the render until they load. Do not add other CSS-bundled fonts.
- All `remotion` / `@remotion/*` packages must share one exact version in the catalog.

### Spec compositions

- **`VideoFromSpec`** renders a whole `RenderableVideoSpec`; **`BeatFromSpec`** renders one beat
  (`beatId`), cut from the same global timeline, so its frames match the full video. Props are
  plain JSON (`src/compositions/props.ts`): `spec`, `series` (label + accent), `channelHandle`,
  `audioSrc`, `fps`.
  Remotion's `schema` prop is not used (Zod 3 vs 4); `calculateMetadata` validates the spec with
  `validateRenderableVideoSpec`, throws its structured errors, and sets duration and fps.
- **`audioSrc` is a URL** (http(s) or `staticFile()`), never a filesystem path: Remotion renders
  in a browser. `null` renders silently (preview before TTS).
- **Timing is seconds in the spec, frames only in the renderer.** `effectiveTiming(spec)` and
  `resolveAnchorSec` live in `packages/shared` (the worker needs them too); `src/timing/frames.ts`
  converts to frames at the composition's fps (final 30, draft 15). Without `spec.timing`, timing
  is estimated at 2.6 words/sec. Event frames are always recomputed from word timings; the
  `timing.events` cache is never read.
- Beat `<Sequence>`s tile the video with no gaps (each runs until the next beat starts).
- Studio previews both compositions with `fixtures/rate-limiter.json` (no timing layer), and the
  primitive boards `PrimitivesBoard` and `SpatialFlowBoard` (`VideoFromSpec` over
  `fixtures/primitives-board.json` and `fixtures/spatial-flow-board.json`: one beat per primitive
  with every action and part action it supports), plus `InsetRevealBoard`
  (`fixtures/inset-reveal-board.json`). Each board is a valid Short (≤ 90 s), so a new
  batch of primitives gets a new board, listed in `primitiveBoardSpecs` (`fixtures/index.ts`).
  Pattern boards (`PatternFlowBoard`, `PatternDecisionBoard`; `patternBoardSpecs`) have one beat
  per pattern with every anchor, and no scene `layoutMode` (each beat takes its pattern's).
- **HUD** (`src/hud`): top bar, step tracker, hero metric pill, chapter header, story clock and
  headline. Slots come from `hudLayout(theme)` (derived from `safeAreas`); what each part shows at
  a frame comes from pure functions in `hud-state.ts`. Parts are toggled per video in `spec.hud`
  (a part without data is not drawn). Chapter header and step tracker default to `auto`, which
  `resolveHud` resolves from `story.devices` (`question_chapters` → header only, else tracker
  only); an explicit true/false is a user override and wins. Every HUD animation starts at a frame
  resolved from a word or beat-edge anchor (`headline.at`, chapter and beat starts).
- **Scene layer** (`src/scene`): `beatWorld` (pure) collects a beat's elements, expanded
  patterns and everything inherited through `continuesPrevious`, each with the events that act on
  it; `BeatScene` draws them with their registered components (through `WorldItemView`, which
  the primitive sheets share). Unknown ids and invalid props are drawn as red, hatched error
  markers, never as content. Placement is a temporary centred wrap at each element's preferred
  size until the layout engine (P1A.9).
  - **Overlays** (`layer: 'overlay'`: `inset_panel`, `statement_card`) are drawn centred over
    the stage above a scrim that dims the board while one shows (`scene-layers.ts`:
    `splitLayers`, `scrimLevel`). At most one should show at a time (`overlay_overlap`).
  - **Containers:** elements a primitive points to with a `contains` element ref (an
    `inset_panel`'s `children`) are nested under it by `beatWorld` and drawn inside it, above
    the scrim. A child's presence is multiplied by its container's (`containedState`), so it
    enters and exits with it; it keeps its own events.
  - **Source footnote:** a beat's `script[].source` is drawn as "Source: …" in the footnote
    style at the stage's bottom-left (`source-footnote.ts`), fading in 0.3 s after the beat
    starts. Required whenever a beat shows a real incident or a sourced number (agent prompts
    enforce it; the layout engine will own its position).
- **`src/dev/` is temporary.** `DevSubtitles` is a stand-in until P1B.3 replaces it. Do not build
  on it or extend it. `src/dev/dev-layers.test.ts` fails once `src/subtitles/` exists and a
  composition still uses `DevSubtitles`.

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
  action it supports (a test enforces it; `exit` and `recover` once per board), and a sheet in `docs/primitives/`
  (`still:primitives <id>`; sheets shrink their panels to fit up to 10 events).
- **Shared pieces:** `common-props.ts` (semantic, asset id, one-line text, part list and element
  ref schemas), `surface.ts` (card surface), `badge.tsx` (corner badge; `SMALL_BADGE` on small
  cards), `motion.ts` (reject shake), `typing.ts` (typing rates), `geometry.ts` (polylines,
  arrowheads, `smoothstep`, `catmullRom`), `overlay.ts` (`riseView`, `zoomView`, `growView`
  entrances), `reveal.ts` (lines that draw on `enter` instead of fading in) and
  `svg-marks.tsx` (cross and pin marks). Prefer them over per-primitive copies.
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
- **Components receive only `{ theme, props, box, state }`**, never events or anchors. `state`
  comes from `elementState(events, frame, fps)` (`primitives/element-state.ts`): `presence`,
  `emphasis` (held highlight or pulse bump), `highlight` (the held highlight alone), `dimmed`, per-action `actions[action]` progress and `elapsed[action]` seconds (both
  0 while the element's first such event is still ahead, absent when it has none),
  `runSec[action]` (below), `starts[action]` (how many occurrences have started, for components
  that step once per occurrence) and `parts` (below). It is the single place events become state;
  P1A.10 upgrades it (easing, focus, stagger) without touching components. An element is present
  from the start unless its first `enter`/`exit` is an `enter`, so it can exit and re-enter.
- **Fail → recover.** A `reject` is held until a later `recover` on the same element or part;
  nothing else ends it (highlight, enter and pulse leave it red; lock is separate). Once a
  recover starts, `actions.reject` reads 0, so components drop their problem look without code
  of their own, and the element plays a short settle bump (emphasis; a ripple in mark themes via
  `markLevels`) in its own colour. `definePrimitive` adds `recover` wherever `reject` is
  supported (`withRecover`, element and parts); definitions never list it. Boards exercise it once
  per board, like `exit`.
- **Parts.** A primitive with `parts: { actions, ids(props) }` (slots, cells, zones, queue
  items, route stops, time segments) lets an event act on named parts: `params.parts: [<id>…]`
  with exactly one target. Those events drive only `state.parts[id]` (read it with
  `partState(state, id)`, `IDLE_STATE` when no event names the part), under the same rules as the
  whole element; the other events drive the element. Verbs map to existing actions, never new
  ones: pick/take → `exit` on the part, put back → `enter`, claim → `lock`, turn red → `reject`,
  back to normal → `recover`,
  change state (a button's label, a jumpy route smoothing) → `morph`. Optional parts work too: a
  `node_card` with a `role` has the part `role` (move a role: `exit` it on the old holder, `enter`
  it on the new one); a primitive whose `ids(props)` is empty has no parts to address. The
  catalogue lists `partActions`.
- **Element refs.** Props that point to other elements (`connector.from/to`,
  `packet_stream.along`, `grid_overlay.over`) are declared by `elementRefs(props)`, optionally
  limited to certain primitives, to some of the target's `parts` (`bracket.parts`), or marked
  `contains` (drawn inside this element; see Containers). Until the layout engine (P1A.9) supplies geometry, relational
  primitives draw a standalone path across their own box (`standalonePath`) and overlays draw on
  their own; `BeatScene` does not connect or stack them yet.
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
- **Assets** (temporary until P1A.11): `src/assets/builtin.ts` is a small set of Lucide glyphs
  (ISC), split into `icon` and `item` kinds; `AssetGlyph` draws one, or a neutral dashed
  placeholder for an unknown id. Asset ids in props are slugs, not enums, so unknown ids are
  warnings, never schema errors.
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
  - **Layout:** `layoutMode` comes from `src/layout/modes.ts` (`LAYOUT_MODE_DEFINITIONS`: the
    P1A.9 modes, each with its allowed zones). Every expanded element sits in a zone of that mode,
    except relational ones (with element refs), which follow what they point to. A beat without
    its own `layoutMode` takes its first pattern's (`beatLayoutMode`); an explicit scene mode wins.
    Do not add modes for a pattern: pick the closest and note it in docs/TODO.md for P1A.9.
  - Building the registry expands each example and rejects (`expansionProblems`): unknown
    primitives, bad props, duplicate ids, zones outside the mode, element refs that leave the
    expansion, unsupported actions or bad parts on events, events not anchored to `params.at`, and
    inner elements missing from `targets`. Instance actions outside `PATTERN_INSTANCE_ACTIONS`
    are rejected too.
  - The scene layer namespaces expanded elements as `<instance>/<id>`, element refs in their
    props included, and keeps each element's `zone` on its world item.
- **Validation:** `withRegistryChecks(validateVideoSpec(input), input)` (or with
  `validateRenderableVideoSpec`) adds registry errors in the same `{ path, code, message }` shape:
  `unknown_reference` for unknown primitive/pattern ids (the message lists valid ids), Zod issue
  codes for props/params with paths into them, and `unsupported_action` for an event action a
  target (including one inherited through `continuesPrevious`) does not support. For
  `params.parts`: `unknown_part` (unknown id, or a target without parts), `parts_need_one_target`,
  and `unsupported_action` at the event's `action` when the parts do not support it. For element
  refs: `unknown_element` (not in the beat's scope), `invalid_element_ref` (itself, the wrong
  primitive, an overlay put in a container, or an element already in another container) and
  `unknown_part` (a ref's parts). It also adds **warnings** (the spec stays valid, Studio shows
  them, agent output repairs them since warnings count as failures there): `unknown_asset` for
  asset ids (from `assetRefs`) missing from the asset registry (a placeholder is drawn), and
  timeline warnings (`catalog/timeline-checks.ts`, from real or estimated timing):
  `overlay_overlap` (two overlays visible at once), `child_before_container` (a contained
  child's event before its container enters) and each primitive's own `eventWarnings(props,
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
