import { describe, expect, it } from 'vitest';
import { deviceFrameEventWarnings, DeviceFramePropsSchema } from './definition.ts';
import { buttonFaces } from './button.ts';

const button = {
  label: 'Claim',
  semantic: 'focus',
  then: { label: 'Claimed ✓', semantic: 'ok' },
} as const;

describe('buttonFaces', () => {
  it('shows the authored button until the morph starts', () => {
    expect(buttonFaces(button, undefined)).toEqual([
      { label: 'Claim', semantic: 'focus', opacity: 1 },
    ]);
    expect(buttonFaces(button, 0)).toHaveLength(1);
  });

  it('cross-fades into then, and shows only then once done', () => {
    expect(buttonFaces(button, 0.25)).toEqual([
      { label: 'Claim', semantic: 'focus', opacity: 0.75 },
      { label: 'Claimed ✓', semantic: 'ok', opacity: 0.25 },
    ]);
    expect(buttonFaces(button, 1)).toEqual([{ label: 'Claimed ✓', semantic: 'ok', opacity: 1 }]);
  });

  it('ignores morph without then', () => {
    const plain = { label: 'Pay', semantic: 'focus' } as const;
    expect(buttonFaces(plain, 1)).toEqual([{ label: 'Pay', semantic: 'focus', opacity: 1 }]);
  });
});

describe('device_frame', () => {
  it('needs something on screen', () => {
    expect(DeviceFramePropsSchema.safeParse({}).success).toBe(false);
    expect(DeviceFramePropsSchema.safeParse({ status: 'Online' }).success).toBe(true);
  });

  it('warns a morph on a device whose button has no then', () => {
    const props = DeviceFramePropsSchema.parse({ button: { label: 'Pay' } });
    expect(deviceFrameEventWarnings(props, [{ action: 'morph' }])).toMatchObject([
      { code: 'morph_without_change' },
    ]);
    const changing = DeviceFramePropsSchema.parse({ button });
    expect(deviceFrameEventWarnings(changing, [{ action: 'morph' }])).toEqual([]);
  });
});
