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
  are generated from the renderer theme into `theme.generated.css` by the studio's `gen:theme`
  script; never edit it by hand (a test fails when it is stale). `styles.css` imports it and adds
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
the theme swatch board to `docs/themes/blueprint-dark.png`; `… still:safe-area` renders the
safe-area overlay to `docs/safe-area/zones.png`; `… still:primitives [ids…]` renders one sheet per
primitive to `docs/primitives/<id>.png`.

- **Themes** live in `src/theme` and are registered by id (`getTheme`, `listThemes`;
  default `blueprint-dark`; `drafting-paper` is a light trial theme). Each is validated against
  `ThemeSchema`. A theme holds colours
  (semantic `neutral`/`focus`/`ok`/`problem`/`concept`), tint and glow rules, grid, fonts, text
  styles, spacing, radius, stroke widths, safe-area margins and `numberLocale` (on-screen number
  grouping; `en-IN` gives 1,00,000). `tint.fills` overrides a semantic's soft fill (paper's
  focus: ink text on a yellow highlighter); each font role has `advanceEm` for size hints
  (`approxTextWidth`). `src/theme` is React-free and
  exported as `@explainer-studio/renderer/theme`, so Node scripts, the layout engine and the
  studio can import it.
- **Theme selection:** `VideoFromSpec`/`BeatFromSpec` take an optional `themeId` (unknown ids
  fail in `calculateMetadata`); `PrimitiveSheet` and `ThemeSwatchBoard` take `themeId`.
  `still:compare [themeIds…]` renders `docs/themes/<theme>.png` and, in `docs/themes/compare/`,
  every primitive sheet plus a mid-video rate-limiter frame per theme.
- **Use the helpers, not raw values:** `tintFor`/`semanticTint` (soft fill, border, glow),
  `textCss`, `safeAreas`.
- **Safe areas** come from per-platform exclusion zones (`topBar`, `actions`, `bottomInfo`: rects
  where Shorts/Reels UI covers the video). `safeAreas(theme)` derives a centred HUD band, stage
  and subtitle band from their union, plus `avoidZones` inside the stage that text and key
  elements must stay out of. The stage's top `headlineBand` is reserved only on beats that show
  a headline: such a beat's board gets `stageWithHeadline` (`stageForBeat(areas, spec, beatId)`). Calibrate zones with `calibrate:safe-area <shorts|reels>` against a
  screenshot in `public/calibration/` (gitignored, as are the `docs/safe-area/*-check.png`
  outputs: they show other creators' videos).
- **Series accents are data**, passed in as props. Apply them with
  `tintFor(theme, resolveAccent(theme, accent))`. `checkAccentContrast` reports low contrast.
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
  with every action and part action it supports). Each board is a valid Short (≤ 90 s), so a new
  batch of primitives gets a new board, listed in `primitiveBoardSpecs` (`fixtures/index.ts`).
- **HUD** (`src/hud`): top bar, step tracker, hero metric pill, chapter header, story clock and
  headline. Slots come from `hudLayout(theme)` (derived from `safeAreas`); what each part shows at
  a frame comes from pure functions in `hud-state.ts`. Parts are toggled per video in `spec.hud`
  (a part without data is not drawn). Chapter header and step tracker default to `auto`, which
  `resolveHud` resolves from `story.devices` (`question_chapters` → header only, else tracker
  only); an explicit true/false is a user override and wins. Every HUD animation starts at a frame
  resolved from a word or beat-edge anchor (`headline.at`, chapter and beat starts).
- **Scene layer** (`src/scene`): `beatWorld` (pure) collects a beat's elements, expanded
  patterns and everything inherited through `continuesPrevious`, each with the events that act on
  it; `BeatScene` draws them with their registered components. Unknown ids and invalid props are
  drawn as red, hatched error markers, never as content. Placement is a temporary centred wrap at
  each element's preferred size until the layout engine (P1A.9).
- **`src/dev/` is temporary.** `DevSubtitles` is a stand-in until P1B.3 replaces it. Do not build
  on it or extend it. `src/dev/dev-layers.test.ts` fails once `src/subtitles/` exists and a
  composition still uses `DevSubtitles`.

### Primitives and patterns

- **Registries:** `src/primitives/registry.ts` (`PRIMITIVE_DEFINITIONS`) and
  `src/patterns/registry.ts` (`PATTERN_DEFINITIONS`, empty until P1A.8). Catalogues, prompts and
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
  action it supports (a test enforces it), and a sheet in `docs/primitives/`
  (`still:primitives <id>`; sheets shrink their panels to fit up to 10 events).
- **Shared pieces:** `common-props.ts` (semantic, asset id, one-line text, part list and element
  ref schemas), `surface.ts` (card surface), `badge.tsx` (corner badge; `SMALL_BADGE` on small
  cards), `motion.ts` (reject shake), `typing.ts` (typing rates), `geometry.ts` (polylines,
  arrowheads, `smoothstep`), `reveal.ts` (lines that draw on `enter` instead of fading in) and
  `svg-marks.tsx` (cross and pin marks). Prefer them over per-primitive copies.
- **Descriptions name only registered ids**, in backticks (a test checks that every backticked
  word is a registered primitive, an action, a part action or a prop). Example strings use
  `<example-…>` placeholders; ids that must be slugs (part ids, element refs) use
  `example-…`.
- **Components receive only `{ theme, props, box, state }`**, never events or anchors. `state`
  comes from `elementState(events, frame, fps)` (`primitives/element-state.ts`): `presence`,
  `emphasis`, `dimmed`, per-action `actions[action]` progress and `elapsed[action]` seconds (both
  0 while the element's first such event is still ahead, absent when it has none),
  `runSec[action]` (below) and `parts` (below). It is the single place events become state;
  P1A.10 upgrades it (easing, focus, stagger) without touching components. An element is present
  from the start unless its first `enter`/`exit` is an `enter`, so it can exit and re-enter.
- **Parts.** A primitive with `parts: { actions, ids(props) }` (slots, cells, zones, queue
  items, route stops, time segments) lets an event act on named parts: `params.parts: [<id>…]`
  with exactly one target. Those events drive only `state.parts[id]` (read it with
  `partState(state, id)`, `IDLE_STATE` when no event names the part), under the same rules as the
  whole element; the other events drive the element. Verbs map to existing actions, never new
  ones: pick/take → `exit` on the part, put back → `enter`, claim → `lock`, turn red → `reject`.
  The catalogue lists `partActions`.
- **Element refs.** Props that point to other elements (`connector.from/to`,
  `packet_stream.along`, `grid_overlay.over`) are declared by `elementRefs(props)`, optionally
  limited to certain primitives. Until the layout engine (P1A.9) supplies geometry, relational
  primitives draw a standalone path across their own box (`standalonePath`) and overlays draw on
  their own; `BeatScene` does not connect or stack them yet.
- **`elapsed` is measured on the global timeline**: `frame / fps` minus the event's unrounded
  resolved seconds (`ElementEvent.sec`), so a beat cut, a draft (15 fps) and the final (30 fps)
  agree, including for actions that started in an earlier beat. Effects that outlast an action's
  fixed duration use it at fixed, capped rates that never depend on beat length (`typing.ts`:
  `command_bubble` ~30 chars/s capped at 1.5 s, `data_block` 0.35 s per field; a `connector`
  packet takes 0.9 s, a `packet_stream` packet 1.2 s, `route_path` draws in 1.5 s,
  `segmented_time_bar` fills 0.35 s per segment capped at 1.5 s). Only
  `timer_ring` runs for narration time: `count` starts it, and its speed is derived, never
  authored (`durationSec / runSec.count`, at least 1), so it reaches 00:00 exactly on the
  `reject` word (expiry, red flash) or, without one, at the element's `exit` or the end of the
  beat, where it holds 00:00. A "⏩ N×" tag shows from `count` on (fading in like an `enter`) when it runs faster
  than real time. Every
  visible change comes from an event.
- **`runSec[action]`** (`actionRunSec`) is how long an occurrence runs, from resolved event
  times: until the element's next `reject`; without one, until its next `exit` or the end of the
  beat it is anchored in (`ElementEvent.beatEndSec`), whichever comes first.
- **Assets** (temporary until P1A.11): `src/assets/builtin.ts` is a small set of Lucide glyphs
  (ISC), split into `icon` and `item` kinds; `AssetGlyph` draws one, or a neutral dashed
  placeholder for an unknown id. Asset ids in props are slugs, not enums, so unknown ids are
  warnings, never schema errors.
- **A pattern** (`definePattern`) has the same shape minus component and size hints, plus
  `anchors` (the narration moments it needs; `params` takes an `EventAnchor` for each) and
  `expand(params) → { elements, events }`. Building the registry expands each example and rejects
  unknown primitives, bad props, duplicate part ids and dangling targets. The scene layer namespaces
  parts as `<instance>/<part>`; spec events on the instance act on every part.
- **Validation:** `withRegistryChecks(validateVideoSpec(input), input)` (or with
  `validateRenderableVideoSpec`) adds registry errors in the same `{ path, code, message }` shape:
  `unknown_reference` for unknown primitive/pattern ids (the message lists valid ids), Zod issue
  codes for props/params with paths into them, and `unsupported_action` for an event action a
  target (including one inherited through `continuesPrevious`) does not support. For
  `params.parts`: `unknown_part` (unknown id, or a target without parts), `parts_need_one_target`,
  and `unsupported_action` at the event's `action` when the parts do not support it. For element
  refs: `unknown_element` (not in the beat's scope) and `invalid_element_ref` (itself, or the
  wrong primitive). It also adds
  `unknown_asset` **warnings** for asset ids (from `assetRefs`) missing from the asset registry:
  the spec stays valid and the placeholder is drawn, but agent output repairs them (warnings
  count as failures there) and Studio shows them.
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
