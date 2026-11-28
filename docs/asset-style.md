# Asset house style

Rules for every SVG in the asset library: the seed set, drafts from the asset drafter (P1C.12)
and uploads (P1D.6). The drafter's prompt is built from this file, so each rule is short and
checkable. `parseHouseSvg` (`packages/renderer/src/assets/house-svg.ts`) enforces the format
rules; the look rules are checked by review. The text between `<!-- drafter -->` markers is what
the Asset drafter reads as HOUSE STYLE (`agents/asset/house-style.ts`): keep it about drawing.

House style version: **1** (`HOUSE_STYLE_VERSION`). Each asset records the version it was drawn
to. Bump the version when a rule below changes, and redraw or re-review older assets.

## What an asset is

- A single generic, line-drawn glyph: a thing (server, parcel, phone) or an idea (lock, speed,
  trade-off).
- Drawn by primitives (`icon`, `item_icon`, `node_card`, `slot_grid`, `device_frame`,
  `route_path`, `conveyor_queue`) at 24–160 px, in the colour the primitive picks.
- Never a brand logo, a real product, a real app screen, a person's likeness or a mascot. Logos
  are not assets: see [Logo slots](#logo-slots).

<!-- drafter -->

## File format

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="5" rx="9" ry="3" />
  <path d="M3 5V19A9 3 0 0 0 21 19V5" />
  <path d="M3 12A9 3 0 0 0 21 12" />
</svg>
```

- **Root:** exactly the `<svg>` above. `viewBox="0 0 24 24"` is required. Allowed root
  attributes: `xmlns`, `viewBox`, `width`, `height`, `fill="none"`, `stroke="currentColor"`,
  `stroke-width`, `stroke-linecap="round"`, `stroke-linejoin="round"`. The renderer sets the
  stroke style itself, so root values never change how an asset draws.
- **Elements:** a flat list of `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`,
  `polygon`. Nothing else: no `g`, `use`, `defs`, `symbol`, `text`, `image`, `foreignObject`,
  `script`, `style`, gradients, filters, masks or clip paths. Shapes are empty elements.
- **Attributes on shapes:** geometry only (`d`, `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `width`,
  `height`, `x1`, `y1`, `x2`, `y2`, `points`) plus `fill` and `stroke` with palette tokens.
  No `id`, `class`, `style`, `transform`, `opacity`, `stroke-width`, event handlers or links.
- **Limits:** at most 48 shapes and 16 KB. Aim for 2–10 shapes. Coordinates with at most two
  decimals.

<!-- /drafter -->

### What the sanitizer does with other files

Drafts and uploads go through `sanitizeAssetSvg` before they are stored. Anything that could run,
style, load or link something is **refused**, never stripped: scripts, event handlers, links
(`href`, `src`), `foreignObject`, images, `use`, styles, animation, DOCTYPEs and entities, and
`javascript:`, `data:` or `url(` anywhere. Anything else outside the format above is reported
(text, gradients, filters, masks, transforms, opacity, colours that are not tokens, another
viewBox, units, a shape outside the box). Harmless editor leftovers are **fixed** and listed:
`title`, `desc`, `metadata` and comments dropped, groups flattened, ids, classes and stroke
styles dropped. Drafts also have their coordinates rounded to two decimals and their look
checked (inside 2-22, large enough, stroked, at most one soft fill, solid fills only on small
marks, no repeated shape); uploads keep their precision.

<!-- drafter -->

## Stroke

- One stroke weight for the whole asset: 2 units in the 24-unit box. The renderer scales it to
  the theme's regular stroke at the drawn size (clamped to 1.5–2.5 units). Never set
  `stroke-width` on a shape and never fake weight with a filled outline.
- Round caps and round joins everywhere.
- Corners: rounded rectangles use `rx="2"` (or `1` below 8 units); sharp corners only where the
  object really has them.

## Palette tokens

The only colours an asset may use:

| Token               | Where                                              | Drawn as                                     |
| ------------------- | -------------------------------------------------- | -------------------------------------------- |
| `currentColor`      | `stroke` (default), `fill` on small solid marks    | The primitive's semantic colour (theme ink). |
| `var(--asset-fill)` | `fill` on one closed shape that reads as a surface | The semantic soft fill, or unfilled.         |
| `none`              | `fill` (default), `stroke` on a filled mark        | Nothing.                                     |

- Never a hex, `rgb()`, named colour or another CSS variable. The theme decides colours; an
  asset that carries its own colour breaks both themes and the semantic states (red on reject,
  focus highlight).
- `var(--asset-fill)` is optional and used sparingly: at most one surface per asset, never on
  thin details. The renderer resolves it to a real colour (it is not left to CSS); primitives
  that pass no fill draw the shape unfilled, so an asset must read correctly without it.
- Solid `currentColor` fills only for marks under about 3 units (dots, LEDs, pin heads).

## Drawing

- **Grid:** keep the live area inside 2–22 on both axes (1 unit of padding). Centre the glyph
  optically; heavy shapes sit slightly above centre.
- **View:** front-on or flat side view. A simple 3/4 view only for boxes and parcels where a
  front view would read as a square. No perspective, no shading, no hatching.
- **Simplicity:** the glyph must read at 32 px. One idea per asset. Drop details that vanish at
  that size (screws, labels, textures).
- **No text:** no letters, digits or words, except a single generic symbol that is the idea
  itself (`#`, `{ }`, `$`-like marks for money are fine; brand letters are not).
- **Consistency:** match the seed set (Lucide-style geometry). When drafting, the drafter gets
  2–3 approved assets of the same family as style examples.
- **Generic only:** a car, not a model of car; a phone, not a branded phone; a chat bubble, not
  a messaging app's bubble.

<!-- /drafter -->

## Metadata

Each asset is a row in the `assets` table plus `<DATA_DIR>/assets/<id>.svg`.

- `id`: a lowercase slug (`a-z`, `0-9`, `_`, `-`), what the thing is (`load_balancer`,
  `credit_card`), never starting with `logo_` (reserved for logo slots).
- `name`: a short display name (`Credit card`).
- `family`: exactly one of `infra`, `network`, `data`, `security`, `people`, `ai`, `time`,
  `object`, `transport`, `ui`, `symbol` (marks and badges: crown, flag, star, check, cross,
  warning), `dev` (code, terminal, git branch, bug, software package).
- `tags`: up to 12 search words, including the words a narrator would use for it.
- `styleVersion`, `licence` (SPDX: `ISC`, `ISC AND MIT`, `CC0-1.0`, or `LicenseRef-own` for
  drafts and uploads made for this project) and `source` (`lucide@<version>:<icon>`, `drafted`,
  `uploaded`).
- `aliases`: up to 8 other ids for the same glyph (`hard_drive` for `disk`). Only true
  synonyms: the Generator substitutes them without asking. An alias is never an asset's id,
  another asset's alias or a `logo_` id.
- `description`: what the glyph shows, one line (drafts and uploads; imported icons have none).
- `status`: `draft`, `approved` or `rejected`. Only approved assets are in the library; nothing
  is approved automatically. A draft (P1C.12) keeps the drafter's variants (three per round,
  files under `assets/drafts/<id>/` with a preview sheet per round) and the reviewer's notes;
  approving one variant writes `assets/<id>.svg` with licence `LicenseRef-own` and source
  `drafted:asset@v<n>`.

## Where the library comes from

- **Core seed set:** 105 curated Lucide icons with hand-picked ids, names and tags
  (`packages/renderer/src/assets/seed.ts`). Fixtures, golden stills and the renderer's offline
  default use only these.
- **Full Lucide import (P1C.12):** every other Lucide icon of the pinned release, imported as
  approved from a committed, reviewed manifest (`apps/studio/seed/assets/lucide.manifest.json`,
  built by `assets:manifest`). An icon is skipped when the core set already has its glyph (its
  Lucide name becomes an alias of the seed id), or it is a brand, a text-formatting control, a
  drawing of letters or digits, or off topic. Its id is the Lucide name in snake case
  (`database-zap` -> `database_zap`), renamed only where a core id draws another glyph
  (`book` -> `book_closed`); its family comes from its first word (`file-clock` is data).
- **Licences:** Lucide is ISC; the icons Lucide's LICENSE lists as derived from Feather (old
  names included) are `ISC AND MIT`. Both texts are in
  `packages/renderer/src/assets/LICENSE-lucide.txt`.
- **Drafts and uploads** (P1C.12, later steps) are `LicenseRef-own`.

Seeding never overwrites an asset it did not create, and keeps the name, tags, family and
status a user edited.

## Missing assets

An id that is not an approved asset (or a declared logo slot) renders as a neutral dashed
placeholder showing a readable label (`rocket_ship` → "rocket ship"), raises an `unknown_asset`
warning, and is recorded in the run's missing-assets list (`runs/<id>/missing-assets.json`) with
the beats that use it. The Generator uses a new id only when no listed asset shows the thing,
and then adds a request to its board (`missingAssetRequests`: the id, what the glyph shows, its
family and the approved id it would use instead); at most one per beat and three per video. The
run records the requests in `asset_requests` after the boards are drawn. The list feeds the asset drafter (P1C.12) and the gate 3 panel (P1D.10).
Placeholders are for drafts only: a final render refuses a spec that still has one.

## Logo slots

- A video may declare up to 4 logo slots in `spec.logos` (`{ id: "logo_<slug>", label }`), a
  run setting the LLM never writes. Primitives use a slot id like an asset id.
- The user supplies the file: SVG or PNG, at most 300 KB and 1024 px on the longest side, at
  `runs/<id>/logos/<slot>.svg` or `.png`. SVGs with scripts, HTML or external references are
  refused. Files are checked when a render loads them (and by the upload, P1D.6).
- Logos are drawn as images in their own colours, contained in the asset's square; they are
  never restyled, drafted, fetched or stored in the library.
- An unfilled slot draws a placeholder with the slot's label in drafts; a final render refuses
  it.
