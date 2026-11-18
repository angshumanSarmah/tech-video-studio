# TODO

Follow-ups noted during tasks instead of done. Reference prompt IDs from the design doc.

## Open

- [ ] **P1A.3 — Share theme tokens with the renderer.** The studio's Tailwind `@theme` in
      `src/web/styles.css` hand-copies the video palette and uses system fonts. Once the
      renderer's `blueprint-dark` theme exists, generate the web tokens from it (or move the
      colour/font tokens into `packages/shared`) and load the bundled mono font in the studio.
- [ ] **P1C.9 — Run state transitions.** The orchestrator takes over run state transitions. Until
      then the worker only moves a run to `failed` when one of its jobs fails (unless the handler
      sets `failsRun: false`); `queued → running`, gate pauses and `done` belong to the
      orchestrator, as does resuming a run from its last finished `run_steps` row.
- [ ] **P1A.12 / P1B.1 — Honour `ctx.signal` in long-running handlers.** Pass it to Remotion's
      `cancelSignal` in renders and kill the Kokoro subprocess on abort; otherwise a dev restart
      becomes a hard kill and uses up an attempt.
- [ ] **Worker — Retries and backoff.** A handler error fails the job at once; `attempts` only
      counts hard crashes. Add per-handler retry with `run_after` backoff when a stage needs it
      (e.g. transient LLM or fetch errors).
- [ ] **Worker — More than one worker.** Stale-lock recovery assumes a single worker (every
      `running` job is stale at startup). A second worker needs a lease (`locked_at` heartbeat +
      timeout) instead.
- [ ] **P1D.2 — List pagination.** `GET /api/runs` and `GET /api/topics` return everything
      (newest first) wrapped as `{ items }`. Add cursor pagination once lists grow.
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
- [ ] **P1A.3 — Remotion compatibility.**
  - Verify Remotion's bundler compiles `@explainer-studio/shared` from TS source: `exports`
    points at `src/index.ts` and imports use explicit `.ts` extensions, so check its loader
    transpiles files outside `packages/renderer`.
  - Check Zod version compatibility with Remotion's schema props: Remotion's `schema` support
    has historically required Zod 3, while `shared` uses Zod 4.
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
