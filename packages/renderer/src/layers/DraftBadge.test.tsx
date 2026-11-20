import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listThemes } from '../theme/index.ts';
import { DraftBadge } from './DraftBadge.tsx';

describe('DraftBadge', () => {
  it('draws "DRAFT" in the top-right corner in every theme', () => {
    for (const theme of listThemes()) {
      const html = renderToStaticMarkup(<DraftBadge theme={theme} />);
      expect(html).toContain('>DRAFT</div>');
      expect(html).toMatch(/top:24px;right:24px/);
    }
  });
});
