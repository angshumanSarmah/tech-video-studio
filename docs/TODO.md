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
- [ ] **Emphasis — HUD.** In mark themes the step tracker (bar style) and the title block's
      SHEET cell mark the current chapter as it starts; the hero metric, chapter header and
      headline have no emphasis yet.
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
- [ ] **Layout — Size hints.** `sizeHints` estimate text width from per-font average advances
      (`src/primitives/measure.ts`), and the layout engine trusts them. If boards overflow their
      boxes, measure glyphs (`@remotion/layout-utils` or the font files) instead.
  - `formula_card` estimates its extent from the LaTeX (`latex-size.ts`: glyph count, fractions
    as wide as their wider part); KaTeX only lays out in a browser. Measure the rendered DOM if
    formulas overflow their card.
  - Sizes are fixed per props, so typing (`data_block`, `command_bubble`) and transitions
    (`counter_transition`) reserve their final size up front and never reflow.
- [ ] **P3.4 — Number locale per channel.** `numberLocale` lives on the theme (`en-IN` in
      `blueprint-dark`). When channels get their own settings, let a channel override it (passed
      through composition props) instead of forking a theme.
- [ ] **P1D.8 — Accent contrast warning.** Renders adapt low-contrast accents (`accentFor`), so
      Settings should show the adapted value next to the stored one per theme (as the swatch board
      does) and warn when they differ, using `accentFor`/`checkAccentContrast` (from
      `@explainer-studio/renderer/theme`, React-free). Importing it
      from `src/web` means updating the web import-boundary message in `eslint.config.js`.
- [ ] **P3.4 — Theme per channel/series.** Themes are registered by id in the renderer
      (`getTheme`, `listThemes`). When a channel or series stores a theme id, validate it against
      the registry (or move the id list into `packages/shared`). The studio tokens stay pinned to
      `STUDIO_THEME_ID` (`blueprint-dark`) unless the UI should follow the video theme.
- [ ] **P1C.4 — Catalogue ids.** Primitive, pattern and layout mode ids, props and params are
      checked by `withRegistryChecks`. The VideoSpec schema still only checks these are slugs:
      `story.beats[].layoutMode` and `suggestedPatternIds`, `story.devices`,
      `story.beats[].device`, `story.metaphorWorld`, `story.ending.kind`,
      `story.missingPrimitiveRequests[].fallbackUsed`. Validate each against its registry or
      catalogue (structured errors with JSON paths, like `validateVideoSpec`).
- [ ] **Parts on `data_block`.** P1A.7 settled the target syntax (`params.parts`, one target).
      Still open: `data_block` fields as parts, so "this `status` flips" highlights one field.
- [ ] **Layout — Places on a map.** `route_path` and `zone_polygon` over a `map_base` share its
      rect but keep their own internal geometry, and `marker` elements sit in a row inside the
      map's top edge. Snapping route stops, zones and markers to places on the map needs named
      places (metaphor worlds, P2). `MAP_DEFAULT_ZONES` (`layout/modes.ts`) names primitive ids;
      move it to a primitive field if more spatial primitives arrive.
- [ ] **P1B.3 — Card format subtitles.** `formatAreas(theme, 'card').subtitleBand` sits under
      the card's headline band (drafting-paper: y 1183, 720 px wide), but `DevSubtitles` (not to
      be extended) still draws at the full format's band. The real subtitle layer must read the
      band from `formatAreas(theme, spec.meta.format)`.
- [ ] **Runs — Episode number in the title block.** The title block's REV cell is the constant
      `REVISION_LABEL` ("REV A"). Replace it with the episode number ("NO. 12") once runs
      carry one.
- [ ] **Layout — Inset, bracket and route geometry.** `inset_panel` zooms from its own centre;
      `enter` should zoom out of its `anchor` element's placed box (transform origin from the
      layout). Its children are a plain stack (no pins or connectors between children). `bracket`
      spans its targets underneath; brace orientation along their shared side, and `parts`
      spans, need part geometry. `route_path`'s mover sits on the end pin when it arrives.
- [ ] **P1B / P1C — Source required.** A beat that shows a real incident or a sourced number must
      carry `BeatScript.source`. Schema code cannot tell, so the Scriptwriter prompt states it
      as a DO rule and the Curator checks it against the research notes (`stat_card` already
      requires its own source).
- [ ] **Scene — Container cycles.** `nestContained` (`scene/beat-world.ts`) never nests an
      overlay, and every container today (`inset_panel`) is an overlay, so containment cannot
      cycle. If a non-overlay container is ever added, add a cycle check (in `nestContained`
      and as a validation error): A contains B contains A would drop both from the scene.
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
- [ ] **Layout — Pattern fits.** `atomic_lock`, `cache_hit_miss` and `worker_pool` pin what
      belongs to another element, and connectors route around elements (P1A.9b), so no fixture
      board reports `connector_crosses`. Still loose:
  - `reject_duplicate` (pipeline): the two id tags sit in `stage`; they travel the link.
  - `inference_card` (pipeline): the comparison row sits in `aside`; it is a parallel lane.
  - `failover` (pipeline): leader and followers share `sink` and replicate inside it.
  - `brute_force_then_index` (centered_focus): the index points into one slot; connectors to a
    part need part endpoints.
  - `split_brain` (versus_split): `link`, `cut` and `restored` should share one path.
  - A pattern's mode is static per definition; a pattern that wants a different mode by params
    would move `layoutMode` into the expansion.
- [ ] **Layout — Routing limits.** Routes avoid elements and pins, not each other: two routed
      connectors may overlap along a shared channel, and several ports on one side all leave from
      the side's centre line. Spread ports and penalise shared runs if boards get busy. Routes
      through narrow gaps get no reserved room (the mode's gaps are for straight links).
- [ ] **Layout — Text outside bodies.** Only `radius_ring` declares `textRects` (its rim label).
      `route_path` stop labels and `zone_polygon` zone labels can also sit under markers on a
      map; declare their label rects so `text_covered` checks them too.
- [ ] **P1C.5 — Format choice.** Patterns declare `formats` / `formatRule` from board scales
      measured on the fixture text. The Director prompt should read them from the catalogue
      when choosing the run's format; re-measure when the card window or a pattern changes.
- [ ] **Layout — Board clip.** The board layer is clipped to its frame plus `space.sm` (so guides
      never leak into the HUD); an emphasis mark or glow on an element at the frame edge loses
      what overhangs further.
- [ ] **Layout — Radial centring.** `centered_focus` and `hub_spoke` centre the others on the
      middle element's cluster (with its pins), so a hub with a side pin sits off centre.
- [ ] **P1C.7 — Layout warnings.** `specLayoutWarnings(spec, theme)` (from
      `@explainer-studio/renderer/catalog`) is not called yet. The Curator runs it on Generator
      output (warnings count as failures there) with the run's theme and format, and the scene
      gate shows it.
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
- [ ] **P1C.7 — Generator rules for the event engine.** The catalogue states the engine's rules
      (focus events, `hold`, `stagger: "scan"`, transitions, `zoomFrom`). Add them to the
      Generator's DO / COMMON MISTAKES: focus what the beat is about (a highlight lifts the
      focus dim only while it shows), leave `transitionIn` at `cut` on continuing beats, keep
      `scan` for deliberate sweeps with room before the next event (`scan_too_short`), and use
      `hold` sparingly.
- [ ] **P1A.8c — Draw-on coverage.** With the `draw` enter style only primitives with an
      `outline` hook draw on (cards, `tag`, `map_base`); lines draw along their path. The rest
      fade in over the draw: `radius_ring` (its stroke is dashed, so a dash-offset draw needs a
      mask), `timer_ring`, `bracket`, `zone_polygon`, `grid_overlay`, `device_frame`,
      `segmented_time_bar`, `slot_grid` and `conveyor_queue` (slots and blocks are parts, which
      keep the fade). Add outlines (circles, polylines) when they should draw. Connectors draw with
      the enter's ease-out over a length-based duration, not a strictly constant pen.
