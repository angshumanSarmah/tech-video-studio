import type { LibraryAsset, LogoFile } from '@explainer-studio/shared';
import type { ComponentProps, ReactNode } from 'react';
import type * as Remotion from 'remotion';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Icon } from '../primitives/icon/Icon.tsx';
import { IconPropsSchema } from '../primitives/icon/definition.ts';
import { ItemIcon } from '../primitives/item-icon/ItemIcon.tsx';
import { ItemIconPropsSchema } from '../primitives/item-icon/definition.ts';
import { IDLE_STATE, type ElementState } from '../primitives/element-state.ts';
import { getTheme } from '../theme/index.ts';
import { AssetProvider } from './AssetContext.tsx';
import { AssetGlyph } from './AssetGlyph.tsx';
import { assetContext, SEED_REGISTRY } from './library.ts';

// Remotion's <Img> needs a composition (it delays the render until the image loads).
vi.mock('remotion', async (importOriginal) => ({
  ...(await importOriginal<typeof Remotion>()),
  Img: (props: ComponentProps<'img'>) => <img {...props} />,
}));

const theme = getTheme();
const state: ElementState = { ...IDLE_STATE, parts: {} };
const box = { width: 160, height: 160 };

const html = (node: ReactNode) => renderToStaticMarkup(node);
const glyph = (assetId: string) => (
  <AssetGlyph theme={theme} assetId={assetId} size={64} colour="#123456" fill="#abcdef" />
);

describe('AssetGlyph', () => {
  it('draws a seeded asset as house shapes in the given colour', () => {
    const out = html(glyph('database'));
    expect(out).toContain('data-asset="database"');
    expect(out).toContain('stroke="#123456"');
    expect(out).toContain('stroke-linejoin="round"');
    expect(out).toContain('<ellipse');
    expect(out).not.toContain('data-asset-placeholder');
  });

  it('resolves the soft-fill token to the given fill', () => {
    const asset: LibraryAsset = {
      ...(SEED_REGISTRY.get('server') as LibraryAsset),
      id: 'filled',
      shapes: [{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '4', fill: 'var(--asset-fill)' } }],
    };
    const out = html(
      <AssetProvider value={assetContext([], [asset])}>{glyph('filled')}</AssetProvider>,
    );
    expect(out).toContain('fill="#abcdef"');
    expect(out).not.toContain('var(--asset-fill)');
  });

  it('draws an unknown id as a neutral placeholder showing a readable label', () => {
    const out = html(glyph('rocket_ship'));
    expect(out).toContain('data-asset-placeholder="rocket_ship"');
    expect(out).toContain('>rocket ship</div>');
    expect(out).not.toContain('<svg');
  });

  it('draws a filled logo slot from its data URI and an unfilled one as its label', () => {
    const logo: LogoFile = {
      kind: 'logo',
      id: 'logo_example',
      mime: 'image/png',
      dataUri: 'data:image/png;base64,iVBORw0KGgo=',
    };
    const slots = [
      { id: 'logo_example', label: '<example-company>' },
      { id: 'logo_other', label: '<example-other>' },
    ];
    const out = html(
      <AssetProvider value={assetContext(slots, [logo])}>
        {glyph('logo_example')}
        {glyph('logo_other')}
      </AssetProvider>,
    );
    expect(out).toContain('data-logo="logo_example"');
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out).toContain('data-asset-placeholder="logo_other"');
    expect(out).toContain('&lt;example-other&gt;');
  });
});

describe('asset primitives', () => {
  it('icon renders a seeded asset', () => {
    const props = IconPropsSchema.parse({ asset: 'gpu' });
    const out = html(<Icon theme={theme} props={props} box={box} state={state} />);
    expect(out).toContain('data-asset="gpu"');
  });

  it('item_icon renders a seeded asset with its caption', () => {
    const props = ItemIconPropsSchema.parse({ asset: 'receipt', caption: 'Order' });
    const out = html(<ItemIcon theme={theme} props={props} box={box} state={state} />);
    expect(out).toContain('data-asset="receipt"');
    expect(out).toContain('Order');
  });

  it('icon and item_icon render the placeholder for an unknown id', () => {
    const icon = IconPropsSchema.parse({ asset: 'quantum_router' });
    const item = ItemIconPropsSchema.parse({ asset: 'quantum_router', caption: 'Order' });
    for (const out of [
      html(<Icon theme={theme} props={icon} box={box} state={state} />),
      html(<ItemIcon theme={theme} props={item} box={box} state={state} />),
    ]) {
      expect(out).toContain('data-asset-placeholder="quantum_router"');
      expect(out).toContain('quantum router');
    }
  });
});
