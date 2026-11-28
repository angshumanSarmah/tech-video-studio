import type { AssetFamily, AssetShape, LibraryAsset } from '@explainer-studio/shared';
import { HOUSE_STYLE_VERSION } from '../assets/house-svg.ts';
import { lineHeightPx } from '../primitives/measure.ts';
import { getPrimitive } from '../primitives/registry.ts';
import type { Theme } from '../theme/index.ts';

/**
 * Layout of the asset draft sheet (`AssetDraftSheet`, P1C.12 A4): one block per draft (its id,
 * family, description and a caption line such as the round and model), then one row per variant:
 * its concept, the glyph at each `DRAFT_SHEET_SIZES`, inside a `node_card` and as an `item_icon`
 * (the two primitives most boards draw an asset with). A variant the sanitizer refused shows its
 * problems instead. The sheet is as tall as its rows (`draftSheetHeight`). Pure.
 */

export const DRAFT_SHEET_SIZES = [32, 64, 160] as const;
/** Problem lines shown for a refused variant. */
export const DRAFT_SHEET_PROBLEM_LINES = 3;

export type DraftSheetVariant = {
  number: number;
  concept: string;
  /** Null when the sanitizer refused it. */
  shapes: AssetShape[] | null;
  problems: string[];
};

export type DraftSheetEntry = {
  id: string;
  name: string;
  family: AssetFamily;
  description: string;
  /** e.g. "round 1 · deepseek-flash". */
  caption: string;
  variants: DraftSheetVariant[];
};

export type DraftSheetColumn = { title: string; drafts: DraftSheetEntry[] };

/**
 * One column of drafts (`title`, `drafts`), or several side by side (`columns`, e.g. one per
 * model when comparing drafters), each as wide as the theme's canvas.
 */
export type DraftSheetProps = {
  themeId: string;
  title: string;
  drafts: DraftSheetEntry[];
  columns?: DraftSheetColumn[];
};

export function sheetColumns(props: DraftSheetProps): DraftSheetColumn[] {
  return props.columns ?? [{ title: props.title, drafts: props.drafts }];
}

/** The id a variant is drawn under on the sheet (each variant, in each column, its own glyph). */
export function variantAssetId(draftId: string, number: number, column = 0): string {
  return `${column > 0 ? `c${column}-` : ''}${draftId}-v${number}`;
}

/** Every drawable variant of a column as a library asset under its sheet id. */
export function variantAssets(drafts: readonly DraftSheetEntry[], column = 0): LibraryAsset[] {
  return drafts.flatMap((draft) =>
    draft.variants.flatMap((v) =>
      v.shapes
        ? [
            {
              kind: 'library' as const,
              id: variantAssetId(draft.id, v.number, column),
              name: draft.name,
              family: draft.family,
              tags: [],
              styleVersion: HOUSE_STYLE_VERSION,
              licence: 'LicenseRef-own',
              source: 'drafted',
              shapes: v.shapes,
            },
          ]
        : [],
    ),
  );
}

/** The props the sheet draws each primitive with. */
export function nodeCardProps(name: string, assetId: string) {
  return { title: name, icon: assetId };
}
export function itemIconProps(name: string, assetId: string) {
  return { asset: assetId, caption: name };
}

/** A primitive's preferred box for these props (its registered size hints). */
export function primitiveBox(
  id: 'node_card' | 'item_icon',
  props: Record<string, unknown>,
  theme: Theme,
): { width: number; height: number; props: unknown } {
  const definition = getPrimitive(id);
  if (!definition) throw new Error(`No primitive "${id}".`);
  const parsed: unknown = definition.propsSchema.parse(props);
  const hints = definition.sizeHints(parsed, theme);
  return { width: hints.preferredWidth, height: hints.preferredHeight, props: parsed };
}

export type DraftSheetMetrics = {
  pad: number;
  titleHeight: number;
  headerHeight: number;
  rowHeight: number;
  gap: number;
};

/** Heights of the sheet's parts for a theme (the tallest drawing sets a row's height). */
export function draftSheetMetrics(theme: Theme, sampleName = 'Example'): DraftSheetMetrics {
  const largest = DRAFT_SHEET_SIZES.at(-1) ?? 0;
  const card = primitiveBox('node_card', nodeCardProps(sampleName, 'example'), theme).height;
  const item = primitiveBox('item_icon', itemIconProps(sampleName, 'example'), theme).height;
  const label = lineHeightPx(theme, 'label');
  return {
    pad: theme.space.xl,
    titleHeight: theme.space.xl * 2,
    headerHeight: lineHeightPx(theme, 'title') + 2 * lineHeightPx(theme, 'body') + theme.space.md,
    rowHeight: label + theme.space.sm + Math.max(largest, card, item),
    gap: theme.space.lg,
  };
}

/** The sheet's size: a canvas-wide column per column, as tall as the tallest. */
export function draftSheetSize(props: DraftSheetProps, theme: Theme) {
  const columns = sheetColumns(props);
  return {
    width: theme.canvas.width * columns.length,
    height: Math.max(...columns.map((c) => draftSheetHeight(c.drafts, theme))),
  };
}

export function draftSheetHeight(drafts: readonly DraftSheetEntry[], theme: Theme): number {
  const m = draftSheetMetrics(theme);
  const rows = drafts.reduce((n, d) => n + Math.max(1, d.variants.length), 0);
  const blocks = drafts.length * (m.headerHeight + m.gap) + rows * (m.rowHeight + m.gap);
  // Even, so encoders that need it never get an odd frame.
  return 2 * Math.ceil((2 * m.pad + m.titleHeight + blocks) / 2);
}
