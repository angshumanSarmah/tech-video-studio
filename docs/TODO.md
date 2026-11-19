# TODO

Follow-ups noted during tasks instead of done. Reference prompt IDs from the design doc.

## Open

- [ ] **Theme — Fill strength on paper.** Semantic fills take the theme's colour
      (`semanticFill`) at each primitive's own alpha (0.16–0.45), not the theme's fill alpha
      (0.55 for focus), so a focus zone or segment is a pale yellow at rest. Add a per-theme
      strength scale if paper fills should read stronger.
- [ ] **Emphasis — Focus underline on wrapping text.** The headline's underline is drawn per line
      as a background (`FocusUnderline wrap`), so it has no −1° tilt; single-line values tilt.
      The hero metric value sits on the pill's own focus fill, so its underline reads as a
      denser band inside the pill.
- [ ] **Emphasis — Clipped frames.** `map_base` clips its content (`overflow: hidden`), so its
      frame mark shows only the inner half of the band. Move the clip to an inner wrapper if the
      full band should show (check blueprint-dark stays byte-identical).
- [ ] **Emphasis — Opaque faces cover the swipe.** `BoxMark` paints over its host's background
      and under its content. Where the face is a child (the `timer_ring` SVG face), only the
      8 px overhang shows, as a yellow halo. Draw the face as the host's background, or let the
      mark go over the face, if the ring should read as fully highlighted.
- [ ] **Emphasis — Part bumps and mark geometry.** Part scale bumps (`slot_grid`,
      `conveyor_queue` blocks ×1.08, route stops ×1.35, `zone_polygon` ×1.03) and packet growth
      are still per primitive; they apply in both styles, like the shared `stateStyle` pulse. Mark
      geometry (8 px overhang, −1°, ripple spread) is constants in `src/emphasis/emphasis.ts`;
      make them theme tokens if a second mark theme needs different values.
- [ ] **Emphasis — HUD.** In mark themes the step tracker marks the current "STEP n/N" as its
      chapter starts; the hero metric, chapter header and headline have no emphasis yet.
- [ ] **Theme — Adapted accents drift from the stored colour.** `seriesAccent` darkens
      (lightens) an accent's OKLCH lightness until it passes on the theme; a strongly adapted
      accent can look unlike the series colour the user picked (e.g. a pale yellow becomes
      olive). If that matters, let a series store a per-theme accent override.
- [ ] **Theme — `colours.background` as on-solid colour.** Badges, check/cross marks, chips and
      route stop holes use `colours.background` for content on a solid tint. It works on both
      themes today; a mid-tone theme would need an `onSolid` token.
- [ ] **Theme — Safe areas live in the theme.** Platform exclusion zones are platform facts;
      `drafting-paper` reuses `blueprintDark.safeArea`. Move platform zones out of the theme
      before a third theme or a recalibration.
- [ ] **Theme — Non-display type per font.** `drafting-paper` scales only its display styles
      (headline, title, chapter, metric) by the display advance ratio. Mono and sans styles keep
      blueprint-dark's sizes (Plex Mono matches JetBrains Mono's 0.6 em; Plex Sans is slightly
      narrower than Inter). Scale them too if a future font differs.
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
- [ ] **P1B.3 — Delete `src/dev/`.** `DevSubtitles` is the last temporary layer in the renderer.
      P1B.3 replaces it and deletes `src/dev/`; `src/dev/dev-layers.test.ts` fails once
      `src/subtitles/` exists and anything outside `src/dev` still uses it (keep the subtitle
      layer at that path, or update the test).
- [ ] **P1C.7 / P1D — Wire registry checks.** `withRegistryChecks` (from
      `@explainer-studio/renderer/catalog`) is not called anywhere yet. The Curator must run it on
      Generator output (its errors feed the repair loop like any other), and scene-gate saves must
      run it too, so a spec cannot pass a gate with unknown primitives, bad props or unsupported
      actions.
- [ ] **P1A.12 — Final renders refuse registry errors.** Studio and drafts draw unknown ids and
      invalid props as red error markers (`src/scene/BeatScene.tsx`). A final render must refuse
      any spec that fails `withRegistryChecks(validateRenderableVideoSpec(spec), spec)` and report
      the structured errors to the run, so a marker can never reach an exported MP4.
  - It must also refuse a spec with any `unknown_asset` warning (a warning everywhere else), so
    an asset placeholder never reaches an export.
- [ ] **P1A.9 — Size hints.** `sizeHints` estimate text width from per-font average advances
      (`src/primitives/measure.ts`). If the layout engine needs exact widths, measure glyphs
      (`@remotion/layout-utils` or the font files) instead. `BeatScene`'s centred wrap is
      temporary; the layout engine replaces it.
  - `formula_card` estimates its extent from the LaTeX (`latex-size.ts`: glyph count, fractions
    as wide as their wider part); KaTeX only lays out in a browser. Measure the rendered DOM if
    formulas overflow their card.
  - Sizes are fixed per props, so typing (`data_block`, `command_bubble`) and transitions
    (`counter_transition`) reserve their final size up front and never reflow.
- [ ] **P1A.10 — Element state.** `elementState` uses linear ramps with an ease-out and fixed
      durations per action. P1A.10 adds easing presets, group stagger and focus dimming there
      (components read only `ElementState`, so they need no changes). Keep `elapsed` measured on
      the global timeline (seconds, not beat-local frames) when reworking it.
- [ ] **P3.4 — Number locale per channel.** `numberLocale` lives on the theme (`en-IN` in
      `blueprint-dark`). When channels get their own settings, let a channel override it (passed
      through composition props) instead of forking a theme.
- [ ] **P1A.10 — Beat transitions.** P1A.10 owns `transitionIn` (cut, fade, slide, zoom-in,
      zoom-out), semantic zoom, focus dimming and the board camera. Until then beats hard-cut:
      `SpecLayers` tiles beat `<Sequence>`s with no overlap and ignores `transitionIn` and
      `focus`. Transitions that overlap two beats must keep `BeatFromSpec` frame-identical to
      `VideoFromSpec` (P1A.12 drafts show transitions into a beat as cuts).
- [ ] **P1A.9 — Safe areas.** `safeAreas(theme)` returns the centred stage the layout engine
      fills, plus `avoidZones` (platform action buttons clipped to the stage). Keep text and key
      elements out of avoid zones; background decoration may pass under. The layout engine picks
      the stage per beat with `stageForBeat(areas, spec, beatId)`: `stageWithHeadline` (940 px
      tall in `blueprint-dark`) when the beat shows a headline and `hud.headline` is on, else the
      full `stage` (1080 px).
- [ ] **P1D.8 — Accent contrast warning.** Renders adapt low-contrast accents (`accentFor`), so
      Settings should show the adapted value next to the stored one per theme (as the swatch board
      does) and warn when they differ, using `accentFor`/`checkAccentContrast` (from
      `@explainer-studio/renderer/theme`, React-free). Importing it
      from `src/web` means updating the web import-boundary message in `eslint.config.js`.
- [ ] **P3.4 — Theme per channel/series.** Themes are registered by id in the renderer
      (`getTheme`, `listThemes`). When a channel or series stores a theme id, validate it against
      the registry (or move the id list into `packages/shared`). The studio tokens stay pinned to
      `STUDIO_THEME_ID` (`blueprint-dark`) unless the UI should follow the video theme.
- [ ] **P1A.9 / P1C.4 — Catalogue ids.** Primitive and pattern ids, props and params are checked
      by `withRegistryChecks` (P1A.5). The VideoSpec schema still only checks these are slugs:
      `scenes[].layoutMode`, `story.beats[].layoutMode` and
      `suggestedPatternIds`, `story.devices`, `story.beats[].device`, `story.metaphorWorld`,
      (`src/layout/modes.ts` now lists the layout mode ids; P1A.8 only checks patterns' modes),
      `story.ending.kind`, `story.missingPrimitiveRequests[].fallbackUsed`. Validate each against
      its registry or catalogue (structured errors with JSON paths, like `validateVideoSpec`).
- [ ] **Parts on `data_block`.** P1A.7 settled the target syntax (`params.parts`, one target).
      Still open: `data_block` fields as parts, so "this `status` flips" highlights one field.
- [ ] **P1A.9 — Geometry for relational primitives and overlays.** `connector` (between
      `from`/`to`), `packet_stream` (along its connector's path) and `route_path` draw a
      standalone path across their own box (`standalonePath`, `routeLayout`); `grid_overlay`
      (`over`), `route_path` and `zone_polygon` on a map draw on their own. The layout engine
      must give relational primitives their path in box coordinates (components already draw
      from a `Point[]`; add it to the component props as layout output, never authored), stack
      overlays on their `over` / `map_base` at the same box and a higher z, and may snap route
      stops and zones to places on the map. `BeatScene`'s wrap shows boards with these elements
      side by side until then.
- [ ] **P1A.9 — Source footnote placement.** The beat source line (`BeatScript.source`) is
      placed by `BeatScene` in the stage's bottom-left corner (`scene/source-footnote.ts`,
      `footnoteRect`), clear of the avoid zones. Its position is owned by the layout engine:
      move it there, and in the "card" format it must sit inside the diagram window.
- [ ] **P1A.9 — Inset, ring and bracket geometry.** `inset_panel` zooms from its own centre;
      `enter` should zoom out of its `anchor` element's placed box (transform origin from layout
      output) and lay its children out in its own frame (nested layout) instead of the scaled
      wrap in `WorldItemView`. `radius_ring` must be centred and sized on its `around` element;
      `bracket` must span its `targets` (or the named parts) along their shared side, which
      also decides its orientation (it draws below its group for now). `route_path`'s mover
      sits on the end pin when it arrives; offset it once the layout gives the pin room.
- [ ] **P1B / P1C — Source required.** A beat that shows a real incident or a sourced number must
      carry `BeatScript.source`. Schema code cannot tell, so the Scriptwriter prompt states it
      as a DO rule and the Curator checks it against the research notes (`stat_card` already
      requires its own source).
- [ ] **P1A.10 — Overlay focus.** The scrim behind `inset_panel` / `statement_card` is drawn by
      `BeatScene` from the overlays' presence (`scene-layers.ts`). When P1A.10 adds focus and
      dimming, fold the scrim into it (overlays as the focus set) so dimming has one source.
- [ ] **P1A.10 — Part stagger.** An event naming several parts (`params.parts: [a, b, c]`)
      starts them together. P1A.10's group stagger should apply to parts too (in
      `elementState`, so components stay unchanged). `brute_force_then_index` relies on it: its
      scan rejects every item in one event and should read as a one-by-one sweep.
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
- [ ] **P1A.11 — Asset library replaces the built-in set.** `src/assets/builtin.ts` (Lucide
      glyphs, ISC) is temporary. P1A.11 swaps the registry behind `getAsset` / `ASSETS` for the
      on-disk library, keeping ids slugs and unknown ids as placeholder + `unknown_asset` warning.
  - Prompts need the closed list of asset ids (rule: closed lists for every id). Add assets to
    `buildCatalogue()` (ids, kind, label) when the library lands.
  - Record the run's missing assets (the placeholder path) for P1C.12 and the gate 3 panel.
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
- [ ] **P1A.9 — Pattern layout inputs.** Patterns declare a layout mode and zones
      (`src/layout/modes.ts`); P1A.9 adds the placement. Where a pattern fits its mode loosely:
  - `reject_duplicate` (pipeline): the two id tags sit in `stage` between sender and receiver;
    they travel the link rather than being a stage.
  - `worker_pool` (pipeline): each `output-<n>` belongs next to `worker-<n>`, but zones carry no
    pairing. Pipeline needs per-row pairing (or attachments) for parallel lanes.
  - `atomic_lock` (hub_spoke): the hold timer and the bounce tag sit in `aside`; they belong
    attached to the resource and the second request (attachments, P1A.9).
  - `cache_hit_miss` (near_far): the HIT and MISS tags belong attached to their links.
  - `inference_card` (pipeline): the comparison row (`compare-features`, `compare-prediction`)
    sits in `aside`; it is a second, parallel lane through the same model.
  - `failover` (pipeline): the leader and followers share the `sink` tier and replicate to each
    other inside it; the writer's arrow moves within that tier on the reroute.
  - `brute_force_then_index` (centered_focus): the index sits `around` the grid and points into
    one slot; a connector to a part (`jump` → `item-<n>`) needs part endpoints.
  - `split_brain` (versus_split): `link`, `cut` and `restored` join the same two nodes and never
    show together; they should share one path.
  - A pattern's mode is static per definition; a pattern that wants a different mode by params
    would move `layoutMode` into the expansion.
- [ ] **Recover without a reject.** A `recover` on an element or part that was never rejected
      (in its `continuesPrevious` chain) is a silent no-op. Add a timeline warning
      (`recover_without_reject`) so agents repair it; the board fixtures are checked by a test.
- [ ] **Recover settle colour.** A recover switches the problem look off at once and plays a
      settle bump in the element's own colour. A cross-fade from problem to the own colour would
      need each component to blend two tints; do it centrally if the snap reads as abrupt.
- [ ] **Timeline warnings for pattern elements.** `findTimelineWarnings` reads only
      `scenes[].elements`, so expanded elements (and spec events on `<instance>/<id>`) get no
      `overlay_overlap`, `child_before_container` or primitive `eventWarnings`. Pattern code is
      tested, but spec events on inner elements could still trip them.
- [ ] **Inner targets beyond events.** `<instance>/<id>` works in `events[].targets` only.
      `focus` ids and element refs from spec elements (a connector from a spec element to an inner
      element) still take plain ids.
- [ ] **`atomic_lock` hold timer.** Without a `reject`, a `timer_ring` runs out at the end of
      its beat, so the 10-minute hold reaches 00:00 as the beat ends even though the story never
      says it expired. A timer that keeps its real pace (or stops at its `exit`) needs a
      `timer_ring` option.
- [ ] **Catalogue — nested params.** The markdown params table shows object params (a pattern's
      `resource: { title, icon }`) as `object` without their fields; the JSON schema has them.
