import type { Insets, Size } from '../primitives/types.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { MARKER_SIZE } from '../scene/marker.ts';
import type { Theme } from '../theme/index.ts';
import { column, single } from './blocks.ts';
import type { PlacedItem } from './types.ts';

/**
 * Nested layout for containers (an `inset_panel`): their children stacked top to bottom in the
 * container's own frame, at their preferred size, and the container sized to hold them (never
 * below its minimum). Child rects are in the container's box px, so they move and scale with it.
 * Pure.
 */

type Container = Extract<WorldItem, { kind: 'primitive' }>;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function insetsOf(item: Container, theme: Theme): Insets {
  return item.definition.contentInset?.(item.props, theme) ?? NO_INSETS;
}

function childSize(child: WorldItem, theme: Theme): Size {
  if (child.kind === 'error') return MARKER_SIZE;
  const hints = child.definition.sizeHints(child.props, theme);
  return { width: hints.preferredWidth, height: hints.preferredHeight };
}

function stack(item: Container, theme: Theme) {
  return column(
    item.children.map((child) => single(child.key, childSize(child, theme))),
    theme.space.lg,
  );
}

/** The container's size: its children's stack plus its insets, at least its minimum size. */
export function containerSize(item: Container, theme: Theme): Size {
  const content = stack(item, theme);
  const insets = insetsOf(item, theme);
  const hints = item.definition.sizeHints(item.props, theme);
  return {
    width: Math.max(hints.minWidth, content.width + insets.left + insets.right),
    height: Math.max(hints.minHeight, content.height + insets.top + insets.bottom),
  };
}

/** The children placed in the container's box px, centred in its content area. */
export function containerChildren(item: WorldItem, theme: Theme, box: Size): PlacedItem[] {
  if (item.kind !== 'primitive' || item.children.length === 0) return [];
  const content = stack(item, theme);
  const insets = insetsOf(item, theme);
  const innerWidth = box.width - insets.left - insets.right;
  const innerHeight = box.height - insets.top - insets.bottom;
  const dx = insets.left + (innerWidth - content.width) / 2;
  const dy = insets.top + (innerHeight - content.height) / 2;
  return item.children.flatMap((child, i) => {
    const r = content.rects.get(child.key);
    if (!r) return [];
    const rect = { ...r, x: r.x + dx, y: r.y + dy };
    return [{ key: child.key, role: 'solid' as const, rect, scale: 1, z: i }];
  });
}
