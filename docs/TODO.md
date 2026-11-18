# TODO

Follow-ups noted during tasks instead of done. Reference prompt IDs from the design doc.

## Open

- [ ] **P0.3 / P0.5 — Job hand-off between server and worker.** SQLite via Drizzle +
      better-sqlite3 (decided, see P0.3), with a `jobs` table polled by the worker (P0.5). Do
      not use `node:sqlite`. The worker's polling seam already exists: `startPollLoop` in
      `apps/studio/src/worker/poll-loop.ts`, wired with a no-op `idleTick` in
      `apps/studio/src/worker/index.ts`. Replace that tick with claim-and-run.
- [ ] **P0.5 — Progress transport.** Choose between an events table and IPC for worker → server
      progress (relayed over SSE), and document the choice in CLAUDE.md. Server and worker run
      as separate processes under `concurrently`, so IPC would need a channel between them; an
      events table needs none.
- [ ] **P0.2 — Config.** The app-config Zod schema moves to `packages/shared` per P0.2. Keep the
      fs-based `loadConfig()` / `saveConfig()` in `apps/studio/src/core/` because the browser
      bundle imports `shared`, which must stay free of `node:` imports. Merge the current
      `EnvSchema` in `apps/studio/src/core/config.ts` into it.
- [ ] **P0.2 / P1C.1 — Missing API key.** `DEEPSEEK_API_KEY` is optional at boot so `pnpm dev`
      works without a key. The LLM client must fail fast with a clear error when the key is
      missing.
- [ ] **P0.4 — Serve the SPA in prod.** Serve `apps/studio/dist/web` from Hono. `pnpm start` runs
      only the built server and worker for now; in dev the SPA is served by Vite, which proxies
      `/api`.
- [ ] **P1A.3 — Remotion compatibility.**
  - Verify Remotion's bundler compiles `@explainer-studio/shared` from TS source: `exports`
    points at `src/index.ts` and imports use explicit `.ts` extensions, so check its loader
    transpiles files outside `packages/renderer`.
  - Check Zod version compatibility with Remotion's schema props: Remotion's `schema` support
    has historically required Zod 3, while `shared` uses Zod 4.
- [ ] **Tooling — TypeScript.** Pinned to `~6.0` because typescript-eslint 8 supports `<6.1`. Move
      to TS 7 once typescript-eslint supports it.
- [ ] **Tooling — vitest.** Pinned exactly to `5.1.0` because 5.1.1 was published 2026-11-18 and
      is younger than pnpm's `minimumReleaseAge`. Bump to `^5.1.1` after the gate passes.
