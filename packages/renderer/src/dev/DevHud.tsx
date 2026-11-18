import type { RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { rectCss } from '../layers/rect-css.ts';
import { safeAreas, textCss, type Theme } from '../theme/index.ts';

/** TEMPORARY HUD layer (P1A.3): series · title, and a badge while timing is estimated. P1A.4 replaces it. */

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  seriesLabel: string;
  accent: string;
  estimated: boolean;
};

export function DevHud({ theme, spec, seriesLabel, accent, estimated }: Props) {
  const { hudBand } = useMemo(() => safeAreas(theme), [theme]);
  return (
    <div
      style={{
        ...rectCss(hudBand),
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: theme.space.md,
      }}
    >
      <div style={{ ...textCss(theme, 'label'), color: accent }}>
        {seriesLabel} · {spec.meta.title}
      </div>
      {estimated ? (
        <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.faint }}>
          estimated timing
        </div>
      ) : null}
    </div>
  );
}
