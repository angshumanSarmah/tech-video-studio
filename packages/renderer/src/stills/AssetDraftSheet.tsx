import { AbsoluteFill } from 'remotion';
import { AssetProvider } from '../assets/AssetContext.tsx';
import { AssetGlyph } from '../assets/AssetGlyph.tsx';
import { assetContext } from '../assets/library.ts';
import { SEED_ASSETS } from '../assets/seed.ts';
import { Background } from '../background/Background.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { componentFor } from '../primitives/components.ts';
import { IDLE_STATE } from '../primitives/element-state.ts';
import {
  DEFAULT_THEME_ID,
  getTheme,
  semanticFill,
  semanticTint,
  textCss,
  type Theme,
} from '../theme/index.ts';
import {
  DRAFT_SHEET_PROBLEM_LINES,
  DRAFT_SHEET_SIZES,
  draftSheetMetrics,
  draftSheetSize,
  itemIconProps,
  nodeCardProps,
  primitiveBox,
  sheetColumns,
  variantAssetId,
  variantAssets,
  type DraftSheetEntry,
  type DraftSheetMetrics,
  type DraftSheetProps,
  type DraftSheetVariant,
} from './asset-draft-sheet.ts';

export type { DraftSheetProps } from './asset-draft-sheet.ts';

const seed = (id: string) => SEED_ASSETS.find((a) => a.id === id)?.shapes ?? null;

export const assetDraftSheetDefaults: DraftSheetProps = {
  themeId: DEFAULT_THEME_ID,
  title: 'Asset drafts',
  drafts: [
    {
      id: 'example_store',
      name: 'Example store',
      family: 'data',
      description: '<example-description>',
      caption: 'round 1 · <example-model>',
      variants: [
        { number: 1, concept: 'A stack of disks', shapes: seed('database'), problems: [] },
        { number: 2, concept: 'A server box', shapes: seed('server'), problems: [] },
        {
          number: 3,
          concept: 'A refused drawing',
          shapes: null,
          problems: ['The shape at $.shapes[0] uses a colour that is not a palette token.'],
        },
      ],
    },
  ],
};

/** Sheet height for these props in their theme (the Still's `calculateMetadata`). */
export function assetDraftSheetMetadata({ props }: { props: DraftSheetProps }) {
  return draftSheetSize(props, getTheme(props.themeId));
}

/**
 * Preview of asset drafts (P1C.12 A4): per variant, the glyph at 32, 64 and 160 px, inside a
 * `node_card` and as an `item_icon`, drawn by the registered components in an idle state, so a
 * reviewer sees each one as boards draw it. Rendered by the studio's `draft_asset` job (one
 * draft) and by `assets:draft-fixture` (a comparison of several).
 */
export function AssetDraftSheet(props: DraftSheetProps) {
  const theme = getTheme(props.themeId);
  loadThemeFonts(theme);
  const m = draftSheetMetrics(theme);
  const columns = sheetColumns(props);
  return (
    <AbsoluteFill>
      <Background theme={theme} />
      <AssetProvider
        value={assetContext(
          undefined,
          columns.flatMap((c, i) => variantAssets(c.drafts, i)),
        )}
      >
        <AbsoluteFill style={{ flexDirection: 'row' }}>
          {columns.map((column, i) => (
            <div
              key={i}
              style={{
                width: theme.canvas.width,
                flexShrink: 0,
                padding: m.pad,
                boxSizing: 'border-box',
                color: theme.colours.ink.primary,
                borderLeft:
                  i > 0 ? `${theme.stroke.regular}px solid ${theme.colours.line}` : 'none',
              }}
            >
              <div style={{ ...textCss(theme, 'title'), height: m.titleHeight }}>
                {column.title}
              </div>
              {column.drafts.map((draft) => (
                <DraftBlock key={draft.id} theme={theme} m={m} draft={draft} column={i} />
              ))}
            </div>
          ))}
        </AbsoluteFill>
      </AssetProvider>
    </AbsoluteFill>
  );
}

type BlockProps = { theme: Theme; m: DraftSheetMetrics; draft: DraftSheetEntry; column: number };

function DraftBlock({ theme, m, draft, column }: BlockProps) {
  const muted = theme.colours.ink.muted;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: m.gap, marginBottom: m.gap }}>
      <div
        style={{
          height: m.headerHeight,
          borderBottom: `${theme.stroke.hairline}px solid ${theme.colours.line}`,
        }}
      >
        <div style={{ ...textCss(theme, 'title'), textTransform: 'none' }}>
          {draft.id} <span style={{ color: muted }}>· {draft.family}</span>
        </div>
        <div style={{ ...textCss(theme, 'body'), whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {draft.description}
        </div>
        <div style={{ ...textCss(theme, 'body'), color: muted }}>{draft.caption}</div>
      </div>
      {draft.variants.map((variant) => (
        <VariantRow
          key={variant.number}
          theme={theme}
          m={m}
          draft={draft}
          variant={variant}
          column={column}
        />
      ))}
    </div>
  );
}

type RowProps = {
  theme: Theme;
  m: DraftSheetMetrics;
  draft: DraftSheetEntry;
  variant: DraftSheetVariant;
  column: number;
};

function VariantRow({ theme, m, draft, variant, column }: RowProps) {
  const label = `v${variant.number} · ${variant.concept}`;
  return (
    <div
      style={{ height: m.rowHeight, display: 'flex', flexDirection: 'column', gap: theme.space.sm }}
    >
      <div
        style={{
          ...textCss(theme, 'label'),
          textTransform: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      {variant.shapes ? (
        <Drawings
          theme={theme}
          name={draft.name}
          assetId={variantAssetId(draft.id, variant.number, column)}
        />
      ) : (
        <Problems theme={theme} problems={variant.problems} />
      )}
    </div>
  );
}

function Drawings({ theme, name, assetId }: { theme: Theme; name: string; assetId: string }) {
  const ink = theme.colours.ink.primary;
  const card = primitiveBox('node_card', nodeCardProps(name, assetId), theme);
  const item = primitiveBox('item_icon', itemIconProps(name, assetId), theme);
  const glyphs = DRAFT_SHEET_SIZES.reduce((w, s) => w + s, 0) + 2 * theme.space.md;
  const room = theme.canvas.width - 2 * theme.space.xl - glyphs - theme.space.lg;
  const width = card.width + theme.space.lg + item.width;
  // Both primitives at one scale (never up), as a board scales what it draws.
  const scale = Math.min(1, room / width);
  const height = Math.max(card.height, item.height);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space.lg }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: theme.space.md }}>
        {DRAFT_SHEET_SIZES.map((size) => (
          <AssetGlyph
            key={size}
            theme={theme}
            assetId={assetId}
            size={size}
            colour={ink}
            {...(size === DRAFT_SHEET_SIZES.at(-1)
              ? { fill: semanticFill(theme, 'focus', 0.5) }
              : {})}
          />
        ))}
      </div>
      <div style={{ width: width * scale, height: height * scale, flexShrink: 0 }}>
        <div
          style={{
            width,
            height,
            display: 'flex',
            alignItems: 'center',
            gap: theme.space.lg,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <Primitive theme={theme} id="node_card" props={nodeCardProps(name, assetId)} />
          <Primitive theme={theme} id="item_icon" props={itemIconProps(name, assetId)} />
        </div>
      </div>
    </div>
  );
}

type PrimitiveProps = {
  theme: Theme;
  id: 'node_card' | 'item_icon';
  props: Record<string, unknown>;
};

/** A registered primitive drawn alone, at its preferred size, idle. */
function Primitive({ theme, id, props }: PrimitiveProps) {
  const Component = componentFor(id);
  const box = primitiveBox(id, props, theme);
  if (!Component) return null;
  return (
    <div style={{ position: 'relative', width: box.width, height: box.height, flexShrink: 0 }}>
      <Component
        theme={theme}
        props={box.props}
        box={{ width: box.width, height: box.height }}
        state={{ ...IDLE_STATE, parts: {} }}
      />
    </div>
  );
}

function Problems({ theme, problems }: { theme: Theme; problems: string[] }) {
  const tint = semanticTint(theme, 'problem');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs }}>
      <div style={{ ...textCss(theme, 'label'), color: tint.base }}>✗ Refused by the sanitizer</div>
      {problems.slice(0, DRAFT_SHEET_PROBLEM_LINES).map((p) => (
        <div key={p} style={{ ...textCss(theme, 'footnote'), textTransform: 'none' }}>
          {p}
        </div>
      ))}
    </div>
  );
}
