import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import {
  AssetIdSchema,
  idsOf,
  lineText,
  PartIdSchema,
  partList,
  semanticProp,
} from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type EventSummary, type SizeHints } from '../types.ts';

export const DEVICE_KINDS = ['phone', 'tablet'] as const;

export const DeviceRowSchema = z.strictObject({
  id: PartIdSchema,
  label: lineText(22, 'Row text: a task, a contact, a message.'),
  detail: lineText(12, 'Optional short value at the right, e.g. 3 MIN.').optional(),
  icon: AssetIdSchema.optional(),
});

export const DeviceButtonStateSchema = z.strictObject({
  label: lineText(16, 'Button text, e.g. Claimed ✓.'),
  semantic: semanticProp('ok', 'Button colour'),
});

export const DeviceButtonSchema = z.strictObject({
  label: lineText(16, 'Button text, e.g. Claim.'),
  semantic: semanticProp('focus', 'Button colour'),
  then: DeviceButtonStateSchema.optional().describe(
    'Optional label and colour the button changes to on morph.',
  ),
});

export const DeviceFramePropsSchema = z
  .strictObject({
    kind: z.enum(DEVICE_KINDS).default('phone').describe('Outline: phone (tall) or tablet.'),
    status: lineText(24, 'Optional status line at the top of the screen.').optional(),
    rows: partList(
      DeviceRowSchema,
      { min: 1, max: 5 },
      'Optional list rows, top to bottom.',
    ).optional(),
    button: DeviceButtonSchema.optional(),
  })
  .refine((p) => p.status || p.rows || p.button, {
    message: 'Give the screen something to show: status, rows or button.',
  });
export type DeviceFrameProps = z.output<typeof DeviceFramePropsSchema>;
export type DeviceButton = z.output<typeof DeviceButtonSchema>;

const SCREEN: Record<(typeof DEVICE_KINDS)[number], { width: number; height: number }> = {
  phone: { width: 420, height: 760 },
  tablet: { width: 760, height: 560 },
};

/** Bezel around the screen, in px. */
export function deviceBezel(theme: Theme): number {
  return theme.space.md;
}

export function deviceFrameSizeHints(props: DeviceFrameProps, theme: Theme): SizeHints {
  const screen = SCREEN[props.kind];
  const pad = theme.space.md;
  const row = (r: z.output<typeof DeviceRowSchema>) =>
    approxTextWidth(theme, 'label', r.label) +
    (r.detail ? theme.space.md + approxTextWidth(theme, 'data', r.detail) : 0) +
    (r.icon ? lineHeightPx(theme, 'label') + theme.space.sm : 0);
  const content = Math.max(0, ...(props.rows ?? []).map(row));
  const width = Math.max(screen.width, content + 2 * pad) + 2 * deviceBezel(theme);
  const height = screen.height + 2 * deviceBezel(theme);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

/** `morph` changes the button: it needs a button with `then`. */
export function deviceFrameEventWarnings(props: DeviceFrameProps, events: readonly EventSummary[]) {
  const morphs = events.some((e) => e.action === 'morph' && !e.parts);
  if (!morphs || props.button?.then) return [];
  return [
    {
      code: 'morph_without_change',
      message: 'morph changes the button to button.then; this device has no button.then.',
    },
  ];
}

export const deviceFramePrimitive = definePrimitive({
  id: 'device_frame',
  family: 'object',
  propsSchema: DeviceFramePropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'morph'],
  sizeHints: deviceFrameSizeHints,
  eventWarnings: deviceFrameEventWarnings,
  assetRefs: (props) =>
    (props.rows ?? []).flatMap((row, i) =>
      row.icon ? [{ path: ['rows', i, 'icon'], id: row.icon }] : [],
    ),
  parts: {
    actions: ['enter', 'exit', 'highlight', 'pulse', 'reject'],
    ids: (props) => idsOf(props.rows ?? []),
  },
  description: {
    summary:
      'A generic phone or tablet outline (`kind`) with a simple screen: a `status` line, list ' +
      '`rows`, and a `button`. `morph` changes the button to its "then" label and colour ' +
      '(Claim → Claimed ✓). Rows are parts: enter one as it arrives, highlight it, or ' +
      'reject it (red with a cross: declined, failed). Never a real app, screenshot or logo.',
    whenToUse:
      'What a user sees: an incoming task, a request to approve, a list of ' +
      'notifications, the status of a payment.',
    whenNotToUse:
      'A server or service (use `node_card`); a phone as an everyday object without a screen ' +
      '(use `item_icon`); data fields (use `data_block`).',
  },
  example: {
    props: {
      status: '<example-status>',
      rows: [{ id: 'example-row', label: '<example-row>', detail: '<example-v>' }],
      button: {
        label: '<example-action>',
        then: { label: '<example-done>', semantic: 'ok' },
      },
    },
  },
});
