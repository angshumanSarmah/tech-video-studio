# TODO

Follow-ups noted during tasks instead of done. Reference prompt IDs from the design doc.

## Open

- [ ] **P0.5 — Job hand-off between server and worker.** Add a `jobs` table to the Drizzle
      schema (P0.3 is done) polled by the worker. Do not use `node:sqlite`. The worker's polling seam already exists: `startPollLoop` in
      `apps/studio/src/worker/poll-loop.ts`, wired with a no-op `idleTick` in
      `apps/studio/src/worker/index.ts`. Replace that tick with claim-and-run.
- [ ] **P0.5 — Progress transport.** Choose between an events table and IPC for worker → server
      progress (relayed over SSE), and document the choice in CLAUDE.md. Server and worker run
      as separate processes under `concurrently`, so IPC would need a channel between them; an
      events table needs none.
- [ ] **P0.2 / P1C.1 — Missing API key.** `DEEPSEEK_API_KEY` is optional at boot so `pnpm dev`
      works without a key. The LLM client must fail fast with a clear error when the key is
      missing.
- [ ] **P1C.1 — Off-peak holidays.** DeepSeek treats Chinese public holidays as off-peak in full;
      the price table only models weekday peak windows, so cost is slightly overestimated on
      those days. Add a holiday list only if the difference matters.
- [ ] **P1C.1 — Model alias drift.** `deepseek-flash` is an alias (currently
      DeepSeek-V4.1-Flash-1017). Record the served model version from each API response in
      `llm_calls` so output changes can be traced to a model swap.
- [ ] **P1D.8 — Settings API.** Never return `llm.apiKey` to the browser; mask it in the GET
      response and treat a masked value in PUT as "unchanged". Show when `DEEPSEEK_API_KEY` in
      `.env` overrides the stored key. Save via `saveConfig()` from `#core/config.ts`, passing
      settings (not the resolved `AppConfig`, which carries the env key).
- [ ] **P0.4 — Serve the SPA in prod.** Serve `apps/studio/dist/web` from Hono. `pnpm start` runs
      only the built server and worker for now; in dev the SPA is served by Vite, which proxies
      `/api`.
- [ ] **P1A.3 — Remotion compatibility.**
  - Verify Remotion's bundler compiles `@explainer-studio/shared` from TS source: `exports`
    points at `src/index.ts` and imports use explicit `.ts` extensions, so check its loader
    transpiles files outside `packages/renderer`.
  - Check Zod version compatibility with Remotion's schema props: Remotion's `schema` support
    has historically required Zod 3, while `shared` uses Zod 4.
- [ ] **P0.4 — DB in server and worker.** Open the DB with `openDatabase(dbPathFor(dataDir))`
      from `#core/db/client.ts` in both processes; add topics/series repositories next to
      `#core/db/repositories/runs.ts`.
- [ ] **P1C ingest — Pin sources per run.** Call `recordRunSources` when a run starts research,
      and write extracted text via `sourceTextPath` so re-fetches never overwrite older versions.
- [ ] **P1C.12 — Asset drafts.** Reuse the `assets` table (status `draft | approved | rejected`)
      for drafts; do not add a separate `asset_drafts` table. Variant SVGs live in files, listed
      in a `variants` column on the asset row.
- [ ] **P1C.15 — Custom element review gate.** The run must pause for custom element review even
      with auto-approve on. Add the gate/pause value (`custom_elements`) to `GATE_IDS` then, and
      decide whether `AutoApproveSchema` excludes it (it is never auto-approved).
- [ ] **DB — Migrations that rebuild tables.** Drizzle's SQLite migrator runs each migration in a
      transaction, where `PRAGMA foreign_keys=OFF` is a no-op. Once migrations are append-only,
      a generated migration that recreates a table with inbound FKs (cascade deletes) needs
      foreign keys disabled outside the transaction. Check the first such migration by hand.
- [ ] **Tooling — Drizzle 1.0.** On the stable 0.45 line. 1.0 changes the migrations folder
      layout and the relations API; upgrade (ideally before the first real video, while
      migrations can still be regenerated) once 1.0 is stable.
- [ ] **Tooling — TypeScript.** Pinned to `~6.0` because typescript-eslint 8 supports `<6.1`. Move
      to TS 7 once typescript-eslint supports it.
- [ ] **Tooling — vitest.** Pinned exactly to `5.1.0` because 5.1.1 was published 2026-11-18 and
      is younger than pnpm's `minimumReleaseAge`. Bump to `^5.1.1` after the gate passes.
