# TODO

Follow-ups noted during tasks instead of done. Reference prompt IDs from the design doc.

## Open

- [ ] **Angle tags: background vs off.** On run 1's replay researcher@v4 tagged the fork,
      copy-on-write and overcommit material `background`, not `off` (snapshots keep disk writes
      off the command path), so `off_angle` cannot fire on a persistence beat; director@v5 still
      dropped the overcommit failure and kept one persistence beat, framed on the angle. If drift
      recurs, either tighten the prompt's `background` ("needed to understand an item that serves
      the angle") or warn at G2 when more than one beat rests only on `background` items.

- [ ] **Dropped conditions on board values.** `claim_drops_condition` covers narration claims
      (the Curator's audit) and stat cards (the Scriptwriter's check). A board value the
      Generator draws (a counter, a data block field) citing a conditioned number still passes:
      extend the check to the claims pass's value entries, owned by the Generator.
- [ ] **Scoped story pass: reasoning variance.** On run 1's b5 replay the scoped claims pass fell
      from 8.3k to ~1.4k output tokens, but the story pass ranged 2.0k to 22k (run 1's own scoped
      story passes: 1.9k to 20.8k). Cap or lower its reasoning for scoped rounds, and measure
      over more replays.

- [ ] **P1C.10 — Series numbers and scratch renders.** `nextSeriesNumber` counts every exported
      run, so a `studio render --final` scratch export takes a number in its series. The usage
      history already leaves those runs out (no `direct` step, no usage rows); count series
      numbers the same way (`exportedVideos`) once the first real video exists.
- [ ] **P1C.10 — Structure at G3 from the drawn patterns.** The Curator runs the Director's
      `structure_repeated` on `planOfSpec`, so it compares the plan's suggested patterns, while
      history stores what boards drew. Drawn reuse is covered per pattern
      (`pattern_recently_used`); pass the drawn sequence to the check if a Generator ever
      rebuilds a recent structure from different suggestions.
- [ ] **P1C.10 — In-progress scratch runs in topic history.** A `studio render` run still
      rendering counts as a topic in progress ("render: <file>"). Harmless (its title rarely
      matches), but leave such runs out if one ever shows up as a `topic_similar` warning.

- [ ] **P1C.7 — Next Generator prompt change: entrances.** Add to the Generator's DO list:
      "Everything a beat adds enters on the word that names it; only the starting focus may be
      there from the start." `element_without_enter` enforces it, but today the model learns it
      only from a repair message. Change the design doc first, then `generator.v3` and re-record.
- [ ] **Scriptwriter — Another system's measured numbers.** Next Scriptwriter prompt change:
      numbers measured in another system or source are attributed ("in one guide's tests,
      a round trip took…"), not framed as an example with "say". The rate limiter's beat5
      says "Say the median round trip is zero point four milliseconds" for the field guide's
      measurement because the plan marks it `exampleNumbers` (needed by `mixed_system_numbers`),
      so `example_not_labelled` requires the marker. Decide the rule for a marked beat whose
      numbers are measurements (attribution as an accepted marker, or a second marking), change
      the design doc first, then the prompt and the check.
- [ ] **Golden — Strawberry takeaway tag.** `golden-strawberry`'s fix beat draws its "1 letter =
      1 token" tag in `focus` beside its focused counter: `focus_colour_off_focus` (advisory,
      pinned in `colour-checks.test.ts`). Make it `concept` and refresh the golden images
      (`UPDATE_GOLDEN=1`), or keep it if two focus marks read well there.
- [ ] **Generator — Text size after the camera.** `generatorCheck` still warns `text_too_small`
      at chain scale; `onScreenTextWarnings` would spare boards whose cameras lift each beat.
      Switch only if live runs show the Generator shrinking boards it did not need to.
- [ ] **P1C.8 — Curator recall.** curator@v3 (one claims entry per drawn value, with a
      subject-and-verb restatement) found the rate limiter's beat2 "capacity" label in every run
      (3 unrecorded and the recorded one; the claims pass files it as unsupported_claim) and the
      tokenizer's "Corrowby bills" in 2 of 3 unrecorded runs but not the recorded one (v2: 0 of 4
      each), the other must-finds every time, and flagged no correct line. "Corrowby bills" is
      still hit or miss: decide between a second claims sample merged with the first (about
      +$0.02 a video) and accepting one sample. The hook-retold seed has never been caught.
- [ ] **P1C.8 — Severity of key-idea clarity.** The above-level seed's "an atomic script" came
      back advisory although the issue itself says it is the beat's key idea; at beginner such an
      issue may block (the cap allows it). Check over more runs whether the model under-rates
      these before tightening the prompt.
- [ ] **P1C.12 A2 — Per-beat asset filter.** The library now holds the full Lucide import (about
      1,860 approved assets), but the Generator's system prompt still lists only the core set
      (`promptRegistries`, a stopgap). A2 moves the list to the user message (at most 60 per
      beat, ids this video already uses first) and removes `promptRegistries`.
- [ ] **P1C.5 — Record catalogue versions per call.** The block's `CATALOGUE VERSIONS` line
      lands in the prompt file and the Director's step input (`catalogueVersions`); a column on
      `llm_calls` would make it queryable.
- [ ] **P1D.1 — Format on the New Run page.** `RunSettings.format` (`full` | `card`) overrides
      the Director's `plan.meta.format`; the New Run form needs a choice ("Director decides",
      full, card).
- [ ] **P1C.10 — Record `device_layout` usage.** The Director's variety check reads
      `usage_history` rows of kind `device_layout` (`<device>/<layout>`, `deviceLayoutCombo`)
      next to device, layout and pattern; the post-export usage writer must record them.
- [ ] **P1C.11 — Reference domains in briefs.** A brief's beat lines keep their structural
      summaries, which carry the original's domain nouns ("a seat", "a rider"); the Director's
      prompt forbids reusing the domain, and only names in `namesToAvoid` are checked. If plans
      start borrowing a reference's domain, add the domain nouns as `example` names.
- [ ] **P1D.7 — Backlog names across requesters.** Reference rows use the analyst's snake_case
      names; run rows keep the Director's and Generator's names as written. Group by a
      normalised name (`catalogueKey`) on the Backlog page, or normalise run names on write.
- [ ] **P1D.7 — Delete a reference.** No `DELETE /api/references/:id` yet (P1D.7 lists none);
      backlog rows would keep the request with `reference_video_id` set null.
- [ ] **P1C.11 — Built-in phrases.** `unmapped_is_built_in` matches whole-word phrases, so a
      broad one ("transition", "zoom") also refuses a genuinely new effect named with it (a 2D
      map into a 3D interior was renamed by the analyst in the seed run). Narrow a phrase when
      that drops something real.
- [ ] **P1C.6 — Story fields for the Scriptwriter.** Copy `beats[].source` into
      `script[].source`; use `newTerms` (gloss each the first time) and `runningExample`. (The
      recap and the cliffhanger now get the parts' context: see "Recap and cliffhanger lines
      unchecked".)
- [ ] **P1C.5 — CTA room hint.** `story.ending.cta` has no length hint in its schema description;
      `hudTextWarnings` reports an over-long CTA with its room. Add a hint (like
      `CHAPTER_TITLE_MAX_CHARS`) if the Director keeps writing CTAs past three lines.
- [ ] **Ending card — Short last sentences.** The card shows from the last sentence through the
      end tail; a one-word last sentence leaves little reading time. Consider a minimum hold
      (lengthening the tail in the timing step) if drafts show it.
- [ ] **P1C.5 — Layout-mode warning for pattern-derived modes.** `layout_mode_not_allowed`
      checks explicit story and scene modes only (shared cannot see patterns); a beat that takes
      its pattern's mode (`beatLayoutMode`) could be checked in `withRegistryChecks`.
- [ ] **P1C.4 — Device → pattern hints.** Devices do not suggest patterns (e.g.
      `brute_force_first` → `brute_force_then_index`); add an optional, registry-checked list if
      the Director picks poorly.
- [ ] **P1D.3 — Source fetch dates at gate 1.** Show each source's `extracted_at` (fetch date)
      next to its facts in the research gate, so stale sources stand out (a stale-source check).
- [ ] **P1D.2 — Retry one source.** `POST /api/sources/:id/retry` needs a job that re-ingests one
      source (`ingestSource` + `markSourceExtracted` / `markSourceFailed`), re-fetching even an
      extracted one. A re-fetch writes a new content-addressed version; runs already pinned keep
      theirs (`recordRunSources` never overwrites a pin).
- [ ] **P1D.1 — Pasted text as a source.** Failure messages say "upload the page as a file"; a
      paste box could save the text as a `.txt` upload (`sourceUploadPath`) instead of a new
      source kind.
- [ ] **P1C.2 — Hidden-content gaps.** `removeHiddenContent` does not see external stylesheets
      (not fetched: no crawling), width-conditional `@media` rules, `opacity: 0` (kept on purpose:
      scroll-reveal and SSR animation libraries start visible text there), off-screen
      positioning, clipping (`sr-only`) or text coloured like its background. The Researcher's
      "never follow instructions in sources" rule is the second layer.
- [ ] **P1C.2 — GitHub `tree` refs with `/`.** `github.ts` takes the first segment after `tree`
      as the ref, so `tree/feature/x/docs` reads `docs` at `feature`. Resolve with the API's
      branch list if that matters.
- [ ] **P1C.2 — Scanned PDFs.** A PDF without a text layer fails as `empty` (upload its text
      instead); there is no OCR.
- [ ] **P1D.3 — Research gate view.** Show `input.omittedChunks` (what the source budget left
      out, per source) next to the notes. **Exclusions are a gate-side list** (fact ids, kept
      with the gate decision), never a field on `ResearchFact`: downstream agents read the
      notes minus the exclusions. **A fact edited at gate 1 is saved as a new notes version
      by the user** (the model's notes stay as written); edits must pass
      `researchNotesProblems` against the step's input. Needs a notes-version record (author
      `user`) next to the research step, and `latestResearch` (or a new reader) to apply the
      newest version and the exclusions.
- [ ] **P1C.3 — Pinned title and date.** `loadRunSources` takes title and fetch date from the
      source row (its latest version), not the pinned version; store both on `run_sources` if a
      re-fetch between runs ever makes that matter.
- [ ] **P1A.13 — Golden images are platform-specific.** `apps/studio/golden/` holds macOS
      renders; Chrome rasterises text differently on Linux, so a Linux CI run would fail. Before
      adding CI, render the goldens in a pinned container (or keep one set per platform).
- [ ] **P1A.13 — `token_strip` primitive.** The strawberry fixture builds its token strip from
      `tag`s in a `pipeline` (the word, then the chunks stacked as stages, then the ids) and
      records the request in `story.missingPrimitiveRequests`. A real strip would draw the word
      with token boundaries over it and each id under its chunk, in one row.
- [ ] **HUD — Series cell in the card header.** The header variant's first bottom cell ellipsizes
      the series label, which is run data (the `series` row), not spec text, so
      `hudTextWarnings` does not check it. Check it when series are edited (Studio settings).
- [ ] **Renderer — Text that spills past its box.** `command_bubble`, `tag`, `connector` labels,
      `conveyor_queue` items and others draw `nowrap` text without clipping, so text wider than
      the box overflows visibly instead of being cut. Hints size them from the average advance;
      check them with `textWidth` too (a `text_overflow` warning, or size hints from real
      advances).
- [ ] **Renderer — Key frame ignores typing and running effects.** `beatKeyFrame` waits for each
      event's preset duration only, so a `data_block` or `command_bubble` entering near a beat's
      end is caught mid-typing in stills (the strawberry fixture pulses its `data_block` on the
      last word to settle it). Let primitives report how long an action's effect runs.
- [ ] **Renderer — Connectors into one sink share a start point.** In `golden-rate-limiter`'s
      `fleet-fix`, `api-a → shared` and `api-b → shared` leave from the same point between the two
      cards and read as one line. Routing should start each from its own card's edge.
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
- [ ] **P1C.9 — Recap and cliffhanger lines unchecked.** A part's recap and cliffhanger are
      prompt rules only: no check that the recap stays within 2 sentences and draws on the part
      before's narration, or that the cliffhanger line names the next part's question. Add
      Scriptwriter checks (the part context is in its input) if live parts drift.
- [ ] **HUD — PART n/N in the bar style.** Only the title block (drafting-paper, and the card
      header in any theme) shows a part's PART n/N. The parked `blueprint-dark` bar HUD shows
      nothing; add it to the top bar if that theme comes back.
- [ ] **P1C.9 — Backlog fallback.** `missing_primitive_requests` has no `fallback_used` column;
      the orchestrator appends "(fallback used: …)" to the description. Add the column (an
      appended migration) when the backlog UI needs to filter by it.
- [ ] **P1D — Gate previews over HTTP.** `GET …/gates/:gate` lists stills and the draft as
      data-dir paths; nothing serves those files yet. The gate views (P1D.3–P1D.5) need a file
      route (or signed paths) and the beat-level actions they list.
- [ ] **P1C.9b — Contact sheet at G4.** The plan's G4 summary shows a contact sheet; the CLI
      prints the stills folder instead. Make `render_stills` write `contact-sheet.png` (the
      `draft:fixture` script's `contactSheet` and PNG helpers) and list it in the gate payload.
- [ ] **P1C.9b — Render runs at gate 4.** `studio render` stops at G4 like any run, and the CLI
      prints the regenerate commands, which a scratch run (no plan or script steps) cannot do.
      Mark render runs and print only approve / reject there.
- [ ] **P1C.9b — `--only` for any step.** `RERUN_STEPS` are the agent and render steps; `tts`
      and `stills` rerun as part of them. Add more if a real run needs them.
- [ ] **P1C.9 step 9 — Gate 1 thresholds.** `THIN_RESEARCH` (6 facts, 1 number, 3,000
      characters) and `MANY_SOURCES` (5) are first guesses. Tune them once real runs show what
      thin research looks like; a topic that is small on purpose can always be approved by hand.
- [ ] **P1D.3 — Structured blocking reasons.** `GateDto.blocking` is a list of strings
      (`<code> at <path>: <message>` for gates 1 and 2). If the gate views need to link a reason
      to the item it names, send `{ path, code, message }` like `checks` and `warnings`.
- [ ] **P1C.2 — Hidden text in Word files.** `.docx` goes through mammoth, whose handling of
      hidden runs (`w:vanish`), comments and tracked deletions is not checked. Uploads are the
      user's own files, so the risk is low; add a fixture and strip them if one ever reaches the
      Researcher.
- [ ] **P1C.9 — Cost cap overshoot.** Calls already in flight when the cap is reached still
      finish (each LLM client checks before a request), so a video can end slightly over its
      cap. A reservation per request (its expected cost) would bound it.
- [ ] **P1B.1 — Pronunciation editing.** `readPronunciations` only reads. Settings (GET/PUT
      `/api/pronunciations`) needs a `savePronunciations` (atomic, validated) in core. Keys are
      single tokens; multi-word keys ("Kafka Streams") and misaki's inline IPA override
      (`[Redis](/ɹˈɛdɪs/)`, exact where a respelling is not) are not supported yet.
- [ ] **P1B.1 — Symbols and currency.** A `$` or `₹` token has no phonemes of its own (misaki
      folds `$10` into "ten dollars"; check how `₹500` is read). Dictionary keys must start and
      end with a letter or digit, so symbols cannot be respelled yet; the Scriptwriter should
      write amounts as words where it matters.
- [ ] **P1B.2 — Estimated gap.** Previews before TTS still estimate beats 0.15 s apart
      (`ESTIMATED_BEAT_GAP_SEC`) while real timing defaults to no gap. Read the run's
      `settings.timing` into the estimate if previews should match; it shifts every fixture and
      golden still, so refresh them in the same change.
- [ ] **P1B.1 — TTS cache growth.** `<DATA_DIR>/tts/cache` is never pruned (~0.5 MB per beat).
      Add a cleanup (entries no spec version references) if it grows.
- [ ] **P1C.9 — Export metadata.** `render_final` records the `exports` row with duration, the
      run's LLM cost and `meta.title`; `thumbnail_path`, `description` and `hashtags` stay null
      until something produces them (the Scriptwriter's tags, a thumbnail still).
- [ ] **P1B.3 — Subtitle chunking is English-only.** The words that must not end a cue
      (`LEANING_WORDS`, `MAGNITUDES` in `subtitles/chunking.ts`) are an English list. Hinglish
      captions need their own list (or a per-language one).
- [ ] **P1B.3 — Subtitles before the final.** The SRT is written only by `render_final`. If the
      draft gate should show or download captions, write `runs/<id>/draft.srt` from the same cues
      in `render_draft`.
- [ ] **Worker — Bundle cache on disk.** The Remotion bundle is built once per worker process
      (`render/bundle.ts`), so every `tsx watch` restart rebuilds it on the next render. If that
      gets slow, keep it under the data dir keyed by `rendererSourceHash()`.
- [ ] **Remotion upgrades — ffmpeg adapter.** `render/ffmpeg.ts` runs Remotion's bundled
      ffmpeg through `RenderInternals.callFf` (internal API). After a Remotion upgrade, run
      `bench:render`: it checks `ffmpeg -version` through the adapter first. The bundled build is
      trimmed (no `ametadata`, for example); check a filter exists before relying on it.
- [ ] **Worker — More than one worker.** Stale-lock recovery assumes a single worker (every
      `running` job is stale at startup). A second worker needs a lease (`locked_at` heartbeat +
      timeout) instead.
- [ ] **P1D.2 — List pagination.** `GET /api/runs` and `GET /api/topics` return everything
      (newest first) wrapped as `{ items }`. Add cursor pagination once lists grow.
- [ ] **P1C.1 — Prompt cache and run overrides.** The prompt variables sit in the preamble's
      first sentence, so a run that overrides length, parts or pace changes the system
      message from its first tokens and misses the provider's prefix cache for that run. Cheap
      while overrides are rare; if they become common, move the filled values into a short
      block after the static sections.
- [ ] **P1C.1 — Off-peak holidays.** DeepSeek treats Chinese public holidays as off-peak in full;
      the price table only models weekday peak windows, so cost is slightly overestimated on
      those days. Add a holiday list only if the difference matters.
- [ ] **P1D.8 — Settings API.** Never return `llm.apiKey` to the browser; mask it in the GET
      response and treat a masked value in PUT as "unchanged". Show when `DEEPSEEK_API_KEY` in
      `.env` overrides the stored key. Save via `saveConfig()` from `#core/config.ts`, passing
      settings (not the resolved `AppConfig`, which carries the env key).
- [ ] **P1B.3 — Delete `src/dev/`.** `DevSubtitles` is the last temporary layer in the renderer.
      P1B.3 replaces it and deletes `src/dev/`; `src/dev/dev-layers.test.ts` fails once
      `src/subtitles/` exists and anything outside `src/dev` still uses it (keep the subtitle
      layer at that path, or update the test).
- [ ] **P1D — Registry checks at the scene gate.** The Generator runs `withRegistryChecks` and
      `specLayoutWarnings` on every answer (`generatorCheck`); scene-gate saves must run them too,
      so a spec cannot pass a gate with unknown primitives, bad props or unsupported actions.
- [ ] **Layout — rows fill to the readable floor.** A wrapped row takes items while the board
      stays readable (`maxRowWidth` = frame / readable scale), not the arrangement that scales
      largest: with real glyph widths, `fan_out`'s three targets now sit in one row at 81% where
      two over one fit at 100% (`worker_pool` 100% -> 87%). Pick the larger-scale arrangement.
- [ ] **Scriptwriter — tags on continuing beats (in reserve).** If continuing beats still fail
      on space in the live rerun, cap a continuing beat's tags (or a chain's) in the
      Scriptwriter, so the script never asks a board for more than it holds.
- [ ] **Catalogue — asset sort.** `buildCatalogue`'s asset groups sort ids with `localeCompare`
      (docs only); the prompt blocks use code-unit order (`assetLines`). Align them if the docs
      order ever matters.
- [ ] **P1C.12 — Editing aliases.** Aliases exist (column, seed aliases, `HAND_ALIASES`
      including `software_package -> module` for the dev `package` case); editing them on an
      approved asset arrives with the assets API (`PUT /api/assets/:id`, A4) and must run
      `aliasProblems` on the library before saving.
- [ ] **P1D.6 — Logo uploads.** Uploads go to `runs/<id>/logos/<slot>.svg|png` and must pass
      `checkLogoFile` (`#core/assets/logo-file.ts`: SVG or PNG, at most 300 KB and 1024 px on
      the longest side, no scripts or external references) before they are written. A slot
      holds one file; replace the other extension on upload.
- [ ] **P1D.10 — Missing-asset decisions.** `runs/<id>/missing-assets.json` holds only what
      each render drew as a placeholder. The panel's decisions (swap, skip, approve a draft)
      need their own storage (a `run_missing_assets` table or a decisions file) so a re-render
      does not lose them.
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
- [ ] **Runs — Episode number in the title block.** A single video's REV cell is the constant
      `REVISION_LABEL` ("REV A"); a part's shows PART n/N. Replace REV A with the episode
      number ("NO. 12") once runs carry one.
- [ ] **Layout — Inset, bracket and route geometry.** `inset_panel` zooms from its own centre;
      `enter` should zoom out of its `anchor` element's placed box (transform origin from the
      layout). Its children are a plain stack (no pins or connectors between children). `bracket`
      spans its targets underneath; brace orientation along their shared side, and `parts`
      spans, need part geometry. `route_path`'s mover sits on the end pin when it arrives.
- [ ] **P1C.8 — Source required, the rest.** `source_missing_on_screen` checks numbers the
      board shows, and the Scriptwriter's `source_missing` checks planned sources and stat cards.
      Still unchecked: a research number only said in the narration, a number that stays on a
      continuing beat without a source line (the footnote is per beat), and a real-incident
      beat without numbers (the Curator's review judges those).
- [ ] **Scene — Container cycles.** `nestContained` (`scene/beat-world.ts`) never nests an
      overlay, and every container today (`inset_panel`) is an overlay, so containment cannot
      cycle. If a non-overlay container is ever added, add a cycle check (in `nestContained`
      and as a validation error): A contains B contains A would drop both from the scene.
- [ ] **P1C.6 — Dashes in narration.** The Scriptwriter puts spaces around dashes (`fast — cheap`)
      so each side is its own word and can be an anchor. Add it to the Scriptwriter's DO rules
      and have the normalizer or a deterministic check flag unspaced dashes.
- [ ] **P1C.5 / P1C.6 — Narration word budget.** A beat's narration budget is
      `(target seconds - its gap/landing) x words per second`: the Director's per-beat target
      and the Scriptwriter's word count leave room for `settings.timing` pauses (the run's
      resolved `beatGapSec`, and `landingSec` for a beat whose last event lands near its end),
      so the timed video still lands on the target length. Words per second comes from the
      voice and speed (measure it from cached syntheses; Kokoro `af_heart` at 1.0 reads about
      2.7 words/s on the rate-limiter fixture: 118 words in 43.2 s).
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
- [ ] **P1D — Layout warnings at the scene gate.** `curatorCodeChecks` runs every code check
      (layout included, with the run's theme and format) on the finished spec; the scene gate
      shows its findings and runs it on saves. Gate 3 reads `latestCuration`: `report.blocking`
      holds the gate, `report.badges` go on their beats (`needsPlanChange` ones offer "back to
      gate 2" rather than "regenerate beat"), and `report.rounds` shows what was repaired.
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
- [ ] **P1A.8c — Draw-on coverage.** With the `draw` enter style only primitives with an
      `outline` hook draw on (cards, `tag`, `map_base`); lines draw along their path. The rest
      fade in over the draw: `radius_ring` (its stroke is dashed, so a dash-offset draw needs a
      mask), `timer_ring`, `bracket`, `zone_polygon`, `grid_overlay`, `device_frame`,
      `segmented_time_bar`, `slot_grid` and `conveyor_queue` (slots and blocks are parts, which
      keep the fade). Add outlines (circles, polylines) when they should draw. Connectors draw with
      the enter's ease-out over a length-based duration, not a strictly constant pen.
- [ ] **P1C.6 — Headline anchors.** `ScriptwriterOutputSchema` leaves `headline.at` out, so
      every headline lands at `DEFAULT_HEADLINE_ANCHOR`. Let the Scriptwriter (or the Generator)
      anchor it to its word once timing needs it.
- [ ] **P1C.6 — Ordinals.** `numberMentions` does not read ordinals ("fourteenth", "the
      ninth"), so a date spoken that way is not checked against the notes. "second" and "first"
      are ordinary words too often to read blindly.
- [ ] **Bare sources: multi-word names.** `isBareSourceLine` catches one word and URL site
      names; a multi-word library title used alone ("Token Kit") is not caught, since it cannot
      be told apart from an article title.
- [ ] **One system: numbers stated but not cited.** `mixed_system_numbers` reads the ids a beat
      cites; an intent that states another source's number without citing its id escapes it.
      Map intent values to research numbers (`researchNumberOf`) and check their sources too.
