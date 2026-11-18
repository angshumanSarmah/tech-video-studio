# TODO

Follow-ups noted during tasks instead of done. Reference prompt IDs from the design doc.

## Open

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
- [ ] **P1A.12 — Render props and narration audio.**
  - Build `VideoFromSpecProps` / `BeatFromSpecProps` (`@explainer-studio/renderer`): resolve
    `series` (label, accent) from the DB `series` row, pass `fps` from the preset (draft 15,
    final 30), and validate the spec with `validateRenderableVideoSpec()` before bundling so
    errors reach the run as structured issues (`calculateMetadata` re-validates and throws).
  - Remotion renders in a browser, so `audioSrc` must be an http(s) URL or a `staticFile()`
    path, never `timing.audioFile` (a path relative to the data dir). Serve the run's audio via
    the studio server (or copy it into Remotion's public dir) and pass that URL.
  - Pass `channelHandle` from the run's channel (`channels.handle`; null hides it).
  - Before rendering, check that `audioSrc` loads (e.g. a `HEAD`/range request that returns an
    audio content type) and fail the render with a clear error if it does not. A spec with
    timing must never render silently; `audioSrc: null` is only for previews before TTS.
- [ ] **P1A.5 / P1B.3 — Delete the Dev\* layers.** `src/dev/` in the renderer is temporary
      (`DevHud` is gone since P1A.4). P1A.5 replaces `DevBeatPreview` with registry-driven
      primitives and deletes it; `src/dev/dev-layers.test.ts` fails once
      `src/primitives/registry.ts` exists and anything outside `src/dev` still uses it (keep the
      registry at that path, or update the test). P1B.3 replaces `DevSubtitles`; delete `src/dev/`
      with the last of them.
- [ ] **P1A.10 — Beat transitions.** P1A.10 owns `transitionIn` (cut, fade, slide, zoom-in,
      zoom-out), semantic zoom, focus dimming and the board camera. Until then beats hard-cut:
      `SpecLayers` tiles beat `<Sequence>`s with no overlap and ignores `transitionIn` and
      `focus`. Transitions that overlap two beats must keep `BeatFromSpec` frame-identical to
      `VideoFromSpec` (P1A.12 drafts show transitions into a beat as cuts).
- [ ] **P1A.9 — Safe areas.** `safeAreas(theme)` returns the centred stage the layout engine
      fills, plus `avoidZones` (platform action buttons clipped to the stage). Keep text and key
      elements out of avoid zones; background decoration may pass under. The layout engine picks
      the stage per beat with `stageForBeat(areas, spec, beatId)`: `stageWithHeadline` (760 px
      tall in `blueprint-dark`) when the beat shows a headline and `hud.headline` is on, else the
      full `stage` (900 px).
- [ ] **Calibrate safe-area zones.** The Shorts/Reels exclusion zones in `blueprint-dark` are
      starting values. Save a full-screen screenshot at
      `packages/renderer/public/calibration/<platform>.png` (a non-9:16 one is centre-cropped), run
      `pnpm --filter @explainer-studio/renderer calibrate:safe-area <shorts|reels>`, compare
      `docs/safe-area/<platform>-check.png`, and adjust the zones (both paths are gitignored).
- [ ] **P1D.8 — Accent contrast warning.** Settings should warn when a series accent fails
      `checkAccentContrast` (from `@explainer-studio/renderer/theme`, React-free). Importing it
      from `src/web` means updating the web import-boundary message in `eslint.config.js`.
- [ ] **P3.4 — Theme per channel/series.** Themes are registered by id in the renderer
      (`getTheme`, `listThemes`). When a channel or series stores a theme id, validate it against
      the registry (or move the id list into `packages/shared`), and have the studio token
      generator follow the selected theme instead of `DEFAULT_THEME_ID`.
- [ ] **P1A.5 / P1A.8 / P1A.9 / P1C.4 — Registry and catalogue ids.** The VideoSpec schema only
      checks these are slugs: `scenes[].elements[].primitive` + `props`,
      `scenes[].patterns[].pattern` + `params`, `scenes[].layoutMode`, `story.beats[].layoutMode` and
      `suggestedPatternIds`, `story.devices`, `story.beats[].device`, `story.metaphorWorld`,
      `story.ending.kind`, `story.missingPrimitiveRequests[].fallbackUsed`. Validate each against
      its registry or catalogue (structured errors with JSON paths, like `validateVideoSpec`).
- [ ] **P1A.8 — Targeting pattern internals.** Events and focus may target a pattern instance id,
      but not the elements a pattern expands into. Decide whether patterns expose named parts
      (e.g. `<instance>.<part>`) and extend the target check in `spec/integrity/scenes.ts`.
- [ ] **P1B.1 / P1B.2 — Word contract.** Word anchors and `timing.beats[].words` count words with
      `narrationWords()` from `packages/shared`. Map TTS tokens back onto that list so the
      timed word count equals it (enforced by `validateVideoSpec`). Cases the mapping must
      handle, where one narration word is several TTS tokens (pinned in `narration.test.ts`):
  - hyphenated words: `write-through` is one word;
  - numbers with separators or decimals: `1,00,000` and `19.4` are one word each, though TTS
    reads them as several;
  - em dashes without spaces: `fast—cheap` is one word, `fast — cheap` is two.
- [ ] **P1C.6 — Dashes in narration.** The Scriptwriter puts spaces around dashes (`fast — cheap`)
      so each side is its own word and can be an anchor. Add it to the Scriptwriter's DO rules
      and have the normalizer or a deterministic check flag unspaced dashes.
- [ ] **P1C.5 / P1C.6 — Research note references.** Check that `story.beats[].factIds` and
      `script[].statCards[].sourceRef` resolve to ids in the run's research notes. These are the
      only spec checks that need research notes; everything else is in `validateVideoSpec`.
- [ ] **P1C.15 — Custom elements in scenes.** An element references a custom element as
      `primitive: "custom_element"` with `props: { customElementId }`. Validate the id against
      the run's approved custom elements (and the max of 2 per video).
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
- [ ] **P1C.4 — Chapter display device ids.** `resolveHud` (`packages/shared/src/spec/hud.ts`)
      reads `story.devices` for `question_chapters` (chapter header only) and `roadmap` (step
      tracker only), exported as `CHAPTER_DISPLAY_DEVICES`. Use these ids for the
      "question-driven chapters" and "roadmap of steps" devices in the device catalogue (or move
      the constants into it).
- [ ] **P1C.5 / P1C.6 — HUD text length.** HUD rows are one line and truncate with an ellipsis.
      With `blueprint-dark`, roughly 30 characters of chapter question fit beside the story clock,
      and the series label + topic share the top bar with the handle. Add soft length limits to
      the Director/Scriptwriter rules (or a deterministic check), or fit text by measuring it
      (`@remotion/layout-utils`) if limits prove too tight.
- [ ] **P1D — HUD toggles in the editor.** `spec.hud` (topBar, chapterHeader, stepTracker,
      heroMetric, storyClock, headline) is user-set and not in the LLM JSON schemas. Expose the
      toggles at the scene gate (form view), and show "estimated timing" in the preview UI (the
      temporary in-frame badge went away with `DevHud`).
