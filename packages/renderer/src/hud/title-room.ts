import { roomInChars, textWidth } from '../fonts/measure-text.ts';
import type { Theme } from '../theme/index.ts';
import { subjectText, titleCellWidth } from './hud-slots.ts';
import { TITLE_LINES } from './title-block.ts';

/**
 * About how many characters of a video title the title-block HUD shows without cutting it, for
 * one series label: the narrower of the strip's subject line after "<LABEL> · " (full format)
 * and the card header's `TITLE_LINES` display lines. The same slots `hudTextWarnings` measures
 * the real title against, so a prompt hint from it matches the check: about 44 after
 * "SYSTEM DESIGN · " (`TITLE_MAX_CHARS`), 55 after "AI · " in the default theme. Pure.
 */
export function titleRoomChars(theme: Theme, seriesLabel: string): number {
  const prefix = textWidth(theme, 'hud', subjectText(seriesLabel, ''));
  const strip = roomInChars(theme, 'hud', titleCellWidth(theme, 'strip') - prefix);
  const card = roomInChars(theme, 'title', titleCellWidth(theme, 'header')) * TITLE_LINES;
  return Math.min(strip, card);
}
