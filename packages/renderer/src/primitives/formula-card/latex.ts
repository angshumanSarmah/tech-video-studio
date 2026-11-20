import { ON_SCREEN_TEXT_LIMITS } from '@explainer-studio/shared';
import katex, { type KatexOptions } from 'katex';

/**
 * LaTeX rendering shared by the props schema (validation) and the component (drawing), so a
 * formula that passes validation always renders. React-free.
 */

export const LATEX_MAX_LENGTH = ON_SCREEN_TEXT_LIMITS.latex;

/** Untrusted input from the LLM: no `\href`/`\url`/HTML, bounded sizes and macro expansion. */
export const KATEX_OPTIONS = {
  // Inline mode avoids `.katex-display` margins; `\displaystyle` keeps display-size fractions.
  displayMode: false,
  output: 'html',
  throwOnError: true,
  trust: false,
  strict: 'error',
  maxSize: 5,
  maxExpand: 100,
} as const satisfies KatexOptions;

export function renderLatex(latex: string, options: KatexOptions = KATEX_OPTIONS): string {
  return katex.renderToString(`\\displaystyle ${latex}`, options);
}

/**
 * Why `latex` cannot be shown, or undefined when it renders cleanly. KaTeX draws refused commands
 * (`\href`, `\url`, `\includegraphics`) as red text instead of throwing, so those are caught
 * through its `trust` callback.
 */
export function latexProblem(latex: string): string | undefined {
  const refused = new Set<string>();
  const trust = (context: { command: string }) => {
    refused.add(context.command);
    return false;
  };
  try {
    renderLatex(latex, { ...KATEX_OPTIONS, trust });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return refused.size > 0 ? `not allowed: ${[...refused].join(', ')}` : undefined;
}
