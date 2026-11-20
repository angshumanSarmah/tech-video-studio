import type { RenderableVideoSpec, VideoFormat } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  allFixtureSpecs,
  goldenRateLimiterSpec,
  goldenStrawberrySpec,
  withFormat,
} from '../../fixtures/index.ts';
import { textWidth } from '../fonts/measure-text.ts';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { getTheme, listThemes } from '../theme/index.ts';
import { specLayoutWarnings } from './spec-layout.ts';
import { TEXT_TRUNCATED } from './text-fit.ts';

const theme = getTheme();
const FORMATS: VideoFormat[] = ['full', 'card'];

function truncations(spec: RenderableVideoSpec) {
  return specLayoutWarnings(spec, theme).filter((w) => w.code === TEXT_TRUNCATED);
}

function withSource(beatId: string, source: string): RenderableVideoSpec {
  const spec = goldenStrawberrySpec;
  return {
    ...spec,
    script: spec.script.map((s) => (s.beatId === beatId ? { ...s, source } : s)),
  };
}

function withElementProps(
  spec: RenderableVideoSpec,
  elementId: string,
  props: Record<string, unknown>,
): RenderableVideoSpec {
  return {
    ...spec,
    scenes: spec.scenes.map((scene) => ({
      ...scene,
      elements: scene.elements.map((e) =>
        e.id === elementId ? { ...e, props: { ...e.props, ...props } } : e,
      ),
    })),
  };
}

describe('text_truncated: source footnote', () => {
  // Calibrated against a draft still of the strawberry fixture (drafting-paper, full format):
  // the browser cut the first source at "…A…" and drew the second one whole.
  const CUT = 'Sennrich, Haddow & Birch, "NMT of Rare Words with Subword Units", ACL 2016';
  const WHOLE = 'Sennrich et al., "NMT of Rare Words with Subword Units", ACL 2016';

  it('warns at the source when the line is wider than the footnote line', () => {
    const warnings = truncations(withSource('tokens', CUT));
    expect(warnings.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: '$.script[1].source', code: TEXT_TRUNCATED },
    ]);
    expect(warnings[0]?.message).toMatch(
      /^Beat "tokens": the source line "Source: Sennrich.*cut off/,
    );
  });

  it('stays quiet for a line the browser draws whole', () => {
    expect(truncations(withSource('tokens', WHOLE))).toEqual([]);
  });
});

describe('text_truncated: primitives', () => {
  it('warns at a node_card subtitle that is wider than its card', () => {
    // Uppercase turns each ß into SS: the rendered line is twice as long as the hint assumed.
    const spec = withElementProps(goldenRateLimiterSpec, 'redis', { subtitle: 'ß'.repeat(20) });
    const warnings = truncations(spec);
    expect(warnings.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: '$.scenes[3].elements[1].props.subtitle', code: TEXT_TRUNCATED },
    ]);
    expect(warnings[0]?.message).toMatch(/^Beat "store", element "redis": "ß+" is \d+ px wide/);
  });

  it.each(listThemes().map((t) => t.id))(
    '%s: every primitive that cuts text fits its own example at its preferred size',
    (id) => {
      const t = getTheme(id);
      for (const definition of DEFAULT_REGISTRIES.primitives.values()) {
        if (!definition.clippedLines) continue;
        const props = definition.propsSchema.parse(definition.example.props);
        const hints = definition.sizeHints(props, t);
        const box = { width: hints.preferredWidth, height: hints.preferredHeight };
        for (const line of definition.clippedLines(props, box, t)) {
          expect(
            textWidth(t, line.style, line.text),
            `${definition.id} ${line.path.join('.')}`,
          ).toBeLessThanOrEqual(line.room + 0.5);
        }
      }
    },
  );
});

describe.each(FORMATS)('every fixture, %s format', (format) => {
  it.each(allFixtureSpecs.map((s) => [s.meta.id, s] as const))(
    '%s cuts no text off',
    (_id, spec) => {
      expect(truncations(withFormat(spec, format))).toEqual([]);
    },
  );
});
