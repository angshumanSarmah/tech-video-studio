import type { WorldItem } from '../scene/beat-world.ts';
import type { BoardLayout, LayoutWarning } from './types.ts';

/**
 * A lower bound on what a board draws (pure; `key_element_too_small`). `text_too_small` pushes
 * the Generator toward smaller elements and nothing pushed back: run 1's b2 drew two icons 73 px
 * wide on a 936 px frame to pass it. A key element is a placed solid whose primitive is a
 * component (`zoomable`: cards, icons, data blocks, devices); tags, metrics, lines and pinned or
 * contained elements are not. Its longer side should be at least `KEY_ELEMENT_MIN_SHARE` of the
 * frame width. Every golden and recorded board's smallest key element is above 0.16.
 */

export const KEY_ELEMENT_MIN_SHARE = 0.1;

export function keyElementWarnings(
  items: readonly WorldItem[],
  board: Pick<BoardLayout, 'items' | 'frame'>,
): LayoutWarning[] {
  const components = new Set(
    items.flatMap((i) => (i.kind === 'primitive' && i.definition.zoomable ? [i.key] : [])),
  );
  const min = board.frame.width * KEY_ELEMENT_MIN_SHARE;
  const small = board.items.filter(
    (p) =>
      p.role === 'solid' && components.has(p.key) && Math.max(p.rect.width, p.rect.height) < min,
  );
  if (small.length === 0) return [];
  const sizes = small
    .map((p) => `${p.key} ${Math.round(p.rect.width)} x ${Math.round(p.rect.height)} px`)
    .join(', ');
  return [
    {
      code: 'key_element_too_small',
      message:
        `Key elements are drawn too small to read on a phone: ${sizes}, under ` +
        `${Math.round(min)} px (${KEY_ELEMENT_MIN_SHARE * 100}% of the ${Math.round(board.frame.width)} px ` +
        'frame). Make them what the board is about: a card with its label instead of a bare ' +
        'icon, or fewer elements beside them so the whole board can scale up.',
      keys: small.map((p) => p.key),
    },
  ];
}
