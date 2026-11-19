import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { stateStyle } from '../primitives/component-props.ts';
import { IDLE_STATE, type ElementState } from '../primitives/element-state.ts';
import { getTheme, semanticTint } from '../theme/index.ts';
import {
  emphasisFilter,
  emphasisLineWidth,
  emphasisShadow,
  emphasisStroke,
  markHostCss,
  markLevels,
  markView,
  RIPPLE_SPREAD,
} from './emphasis.ts';
import { BoxMark, LineMark, PointMark } from './Mark.tsx';

const dark = getTheme('blueprint-dark');
const paper = getTheme('drafting-paper');

const state = (patch: Partial<ElementState>): ElementState => ({
  ...IDLE_STATE,
  parts: {},
  ...patch,
});

const idle = state({});
const highlighted = state({ emphasis: 1, highlight: 1, actions: { highlight: 1 } });
/** Mid-pulse: the bump is up, the pulse's eased progress is halfway, no held highlight. */
const pulsing = state({ emphasis: 1, highlight: 0, actions: { pulse: 0.5 } });
const pulsed = state({ emphasis: 0, highlight: 0, actions: { pulse: 1 } });

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('emphasis in a glow theme (blueprint-dark)', () => {
  const tint = semanticTint(dark, 'concept');

  it('glows while highlighted or pulsing, and not at rest', () => {
    for (const s of [highlighted, pulsing]) {
      expect(emphasisShadow(dark, tint, s.emphasis)).toBe(tint.glowShadow);
      expect(emphasisFilter(dark, tint, s.emphasis)).toBe(tint.glowFilter);
    }
    expect(emphasisShadow(dark, tint, idle.emphasis)).toBe('none');
    expect(emphasisFilter(dark, tint, idle.emphasis)).toBeUndefined();
  });

  it("keeps each primitive's own widths, so its output is unchanged", () => {
    expect(emphasisStroke(dark, 4, highlighted)).toBe(4);
    expect(emphasisLineWidth(dark, highlighted, { rest: 4, glow: 6 })).toBe(6);
    expect(markHostCss(dark)).toEqual({});
  });

  it('draws no marks', () => {
    expect(markView(dark, markLevels(highlighted))).toBeNull();
    expect(html(<BoxMark theme={dark} levels={markLevels(highlighted)} />)).toBe('');
    expect(
      html(<PointMark theme={dark} levels={{ highlight: 1 }} at={{ x: 0, y: 0 }} r={4} />),
    ).toBe('');
    const line = <LineMark theme={dark} levels={{ highlight: 1 }} d="M0 0 L10 0" width={4} />;
    expect(html(<svg>{line}</svg>)).toBe('<svg></svg>');
  });
});

describe('emphasis in a mark theme (drafting-paper)', () => {
  const tint = semanticTint(paper, 'concept');
  const { regular, bold } = paper.stroke;

  it('never glows', () => {
    expect(emphasisShadow(paper, tint, highlighted.emphasis)).toBe('none');
    expect(emphasisFilter(paper, tint, pulsing.emphasis)).toBeUndefined();
  });

  it('highlight: a full swipe and outlines and lines going from regular to bold', () => {
    expect(markView(paper, markLevels(highlighted))).toEqual({ swipe: 1 });
    expect(emphasisStroke(paper, regular, highlighted)).toBe(bold);
    expect(emphasisStroke(paper, regular, idle)).toBe(regular);
    expect(emphasisLineWidth(paper, highlighted, { rest: regular, glow: 99 })).toBe(bold);
    const box = html(<BoxMark theme={paper} levels={markLevels(highlighted)} />);
    expect(box).toContain('rotate(-1deg)');
    expect(box).toContain('rgb(255 216 77 / 0.55)');
  });

  it('pulse: an ink ripple that spreads and fades, plus the shared scale bump', () => {
    expect(markView(paper, markLevels(pulsing))).toEqual({
      swipe: 0,
      ripple: { spread: RIPPLE_SPREAD / 2, opacity: 0.5 },
    });
    expect(stateStyle(pulsing).transform).toBe('scale(1.06)');
    const line = <LineMark theme={paper} levels={markLevels(pulsing)} d="M0 0 L10 0" width={4} />;
    expect(html(<svg>{line}</svg>)).toContain('mask=');
  });

  it('draws nothing at rest or once a pulse has played out', () => {
    expect(markView(paper, markLevels(idle))).toBeNull();
    expect(markView(paper, markLevels(pulsed))).toBeNull();
    expect(html(<BoxMark theme={paper} levels={markLevels(idle)} />)).toBe('');
  });

  it('isolates the host so the swipe sits over its background, under its content', () => {
    expect(markHostCss(paper)).toEqual({ position: 'relative', isolation: 'isolate' });
  });
});
