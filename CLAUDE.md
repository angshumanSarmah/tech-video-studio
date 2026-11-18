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
  src/web/              Vue 3 + Vite SPA
  drizzle/              generated SQL migrations (drizzle-kit)
packages/shared/        Zod schemas, catalogues, inferred types (consumed as TS source)
packages/renderer/      Remotion compositions (React)
data/                   runtime data: SQLite DB, runs/, topics/, assets/, exports/ (gitignored)
docs/TODO.md            follow-ups logged instead of done
```

Prerequisites: `nvm use` (Node 24, from `.nvmrc`), then `corepack enable pnpm` so `pnpm` resolves to
the version pinned in `packageManager`. Re-run it after switching Node versions; do not install pnpm
globally.

Commands (from the repo root): `pnpm dev` (server, worker and Vite via `concurrently`),
`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`.

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
