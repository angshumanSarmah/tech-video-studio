import { describe, expect, it } from 'vitest';
import { FormulaCardPropsSchema } from './definition.ts';
import { estimateLatexExtent } from './latex-size.ts';
import { LATEX_MAX_LENGTH, latexProblem, renderLatex } from './latex.ts';

const parse = (latex: string) => FormulaCardPropsSchema.safeParse({ latex });

describe('formula_card props', () => {
  it('accepts LaTeX that KaTeX renders', () => {
    expect(parse('\\text{hit ratio} = \\frac{h}{h + m}').success).toBe(true);
    expect(parse('\\mathrm{softmax}(QK^T / \\sqrt{d_k})V').success).toBe(true);
  });

  it('rejects LaTeX that KaTeX cannot parse, with its message', () => {
    const result = parse('\\frac{a}{');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/^Invalid LaTeX: /);
  });

  it('rejects untrusted commands and LaTeX over the length cap', () => {
    expect(parse('\\href{https://example.com}{x}').success).toBe(false);
    expect(parse('\\htmlClass{x}{y}').success).toBe(false);
    expect(parse('x'.repeat(LATEX_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('bounds macro expansion and sizes', () => {
    const bomb = '\\def\\a{xxxxxxxx}\\def\\b{\\a\\a\\a\\a}\\def\\c{\\b\\b\\b\\b}\\c\\c\\c\\c\\c';
    expect(latexProblem(bomb)).toBeDefined();
    expect(renderLatex('\\rule{100em}{1em}')).toBeTypeOf('string');
  });
});

describe('estimateLatexExtent', () => {
  it('grows with visible glyphs and ignores structural commands', () => {
    const short = estimateLatexExtent('a+b');
    const long = estimateLatexExtent('a+b+c+d+e+f');
    expect(long.widthEm).toBeGreaterThan(short.widthEm);
    expect(estimateLatexExtent('\\mathrm{ab}').widthEm).toBe(estimateLatexExtent('ab').widthEm);
  });

  it('makes a fraction as wide as its wider part', () => {
    const fraction = estimateLatexExtent('\\frac{abcd}{ab}').widthEm;
    expect(fraction).toBeGreaterThan(estimateLatexExtent('abcd').widthEm);
    expect(fraction).toBeLessThan(estimateLatexExtent('abcdab').widthEm);
  });

  it('is taller for fractions', () => {
    expect(estimateLatexExtent('\\frac{a}{b}').heightEm).toBeGreaterThan(
      estimateLatexExtent('a/b').heightEm,
    );
  });
});
