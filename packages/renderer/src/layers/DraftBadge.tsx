import { textCss, type Theme } from '../theme/index.ts';

/** Inset from the canvas corner, in canvas px. Drafts are never uploaded, so safe areas do not apply. */
const CORNER_INSET = 24;

/** A small "DRAFT" badge in the top-right corner of every draft render (beat clips and joined draft). */
export function DraftBadge({ theme }: { theme: Theme }) {
  const problem = theme.colours.semantic.problem;
  return (
    <div
      data-testid="draft-badge"
      style={{
        position: 'absolute',
        top: CORNER_INSET,
        right: CORNER_INSET,
        padding: '4px 12px',
        border: `${theme.stroke.thin}px solid ${problem}`,
        borderRadius: theme.radius.sm,
        background: theme.colours.surface,
        ...textCss(theme, 'label'),
        color: problem,
        letterSpacing: '0.12em',
      }}
    >
      DRAFT
    </div>
  );
}
