import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { componentFor } from '../primitives/components.ts';
import { IDLE_STATE, type ElementState, type PartState } from '../primitives/element-state.ts';
import { getPrimitive } from '../primitives/registry.ts';
import {
  getTheme,
  SEMANTIC_COLOURS,
  semanticFill,
  ThemeSchema,
  type SemanticColour,
  type Theme,
} from '../theme/index.ts';
import { focusUnderlineView, UNDERLINE_ALPHA } from './emphasis.ts';
import { FocusUnderline } from './Mark.tsx';

const dark = getTheme('blueprint-dark');
const paper = getTheme('drafting-paper');
const FOCUS_FILL = 'rgb(255 216 77 / ';

describe('semanticFill', () => {
  it("fills focus with the theme's focus fill colour at the primitive's strength", () => {
    expect(semanticFill(paper, 'focus', 0.3)).toBe(`${FOCUS_FILL}0.3)`);
    expect(semanticFill(paper, 'ok', 0.3)).toBe('rgb(30 123 76 / 0.3)');
  });

  it('is the plain semantic colour without an override (blueprint-dark output unchanged)', () => {
    for (const s of SEMANTIC_COLOURS) {
      const { r, g, b } = hexRgb(dark.colours.semantic[s]);
      expect(semanticFill(dark, s, 0.22)).toBe(`rgb(${r} ${g} ${b} / 0.22)`);
    }
  });
});

/** Paper with every semantic filling like focus, so any semantic fill a primitive draws shows. */
const allFocus: Theme = ThemeSchema.parse({
  ...paper,
  tint: {
    ...paper.tint,
    fills: Object.fromEntries(SEMANTIC_COLOURS.map((s) => [s, paper.tint.fills.focus])),
  },
});

const lit: PartState = { ...IDLE_STATE, emphasis: 1, highlight: 1, actions: { highlight: 1 } };

function render(id: string, theme: Theme, patch: (props: never) => unknown = (p) => p) {
  const definition = getPrimitive(id);
  const Component = componentFor(id);
  if (!definition || !Component) throw new Error(`no primitive ${id}`);
  const props = patch(definition.propsSchema.parse(definition.example.props) as never);
  const partIds = definition.parts?.ids(props) ?? [];
  const state: ElementState = {
    ...IDLE_STATE,
    parts: Object.fromEntries(partIds.map((p) => [p, lit])),
  };
  const box = { width: 800, height: 600 };
  return renderToStaticMarkup(<Component theme={theme} props={props} box={box} state={state} />);
}

const withFocus = (key: string) => (props: Record<string, unknown>) => ({
  ...props,
  [key]: (props[key] as { semantic: SemanticColour }[]).map((x) => ({ ...x, semantic: 'focus' })),
});

describe('primitive fills come from the theme', () => {
  it.each([
    ['zone_polygon', withFocus('zones')],
    ['segmented_time_bar', withFocus('segments')],
    ['grid_overlay', withFocus('cells')],
    ['packet_stream', (p: Record<string, unknown>) => ({ ...p, semantic: 'focus' })],
  ])('%s fills focus with the theme focus fill', (id, patch) => {
    expect(render(id, paper, patch as never)).toContain(FOCUS_FILL);
  });

  it('map_base parks take the theme fill path too (they are always `ok`)', () => {
    expect(render('map_base', allFocus)).toContain(FOCUS_FILL);
    expect(render('map_base', paper)).not.toContain(FOCUS_FILL);
  });
});

describe('resting focus underline', () => {
  it('shows at rest only for focus, only in mark themes', () => {
    expect(focusUnderlineView(paper, 'focus')).toEqual({
      fill: `${FOCUS_FILL}${UNDERLINE_ALPHA})`,
    });
    for (const s of SEMANTIC_COLOURS.filter((x) => x !== 'focus')) {
      expect(focusUnderlineView(paper, s)).toBeNull();
    }
    expect(focusUnderlineView(dark, 'focus')).toBeNull();
  });

  it('is replaced by the swipe while highlighted (never both)', () => {
    expect(focusUnderlineView(paper, 'focus', 0.2)).toBeNull();
    const counter = (highlight: number) =>
      renderToStaticMarkup(
        <FocusUnderline theme={paper} semantic="focus" highlight={highlight}>
          42
        </FocusUnderline>,
      );
    expect(counter(0)).toContain('rotate(-1deg)');
    expect(counter(1)).toBe('42');
  });

  it('renders the bare text in glow themes and for other semantics', () => {
    const bare = (theme: Theme, semantic: SemanticColour) =>
      renderToStaticMarkup(
        <FocusUnderline theme={theme} semantic={semantic}>
          42
        </FocusUnderline>,
      );
    expect(bare(dark, 'focus')).toBe('42');
    expect(bare(paper, 'ok')).toBe('42');
  });

  it('underlines wrapping text per line', () => {
    const html = renderToStaticMarkup(
      <FocusUnderline theme={paper} semantic="focus" wrap>
        A long decision headline
      </FocusUnderline>,
    );
    expect(html).toContain('box-decoration-break:clone');
    expect(html).toContain(`linear-gradient(transparent 55%, ${FOCUS_FILL}`);
  });

  it('underlines a focus counter at rest and swaps to the swipe on highlight', () => {
    const counter = getPrimitive('counter');
    const Component = componentFor('counter');
    if (!counter || !Component) throw new Error('no counter');
    const props = counter.propsSchema.parse({
      ...(counter.example.props as object),
      semantic: 'focus',
    });
    const html = (state: ElementState) =>
      renderToStaticMarkup(
        <Component theme={paper} props={props} box={{ width: 400, height: 200 }} state={state} />,
      );
    const rest = html({ ...IDLE_STATE, parts: {} });
    expect(rest).toContain(`${FOCUS_FILL}${UNDERLINE_ALPHA})`);
    const highlighted = html({
      ...IDLE_STATE,
      emphasis: 1,
      highlight: 1,
      actions: { highlight: 1 },
      parts: {},
    });
    expect(highlighted).not.toContain(`${FOCUS_FILL}${UNDERLINE_ALPHA})`);
    expect(highlighted).toContain(`${FOCUS_FILL}0.55)`);
  });
});

function hexRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
