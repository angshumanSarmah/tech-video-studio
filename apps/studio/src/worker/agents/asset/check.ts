import { sanitizeAssetSvg, serializeHouseSvg } from '@explainer-studio/renderer/catalog';
import type { AssetShape } from '@explainer-studio/shared';
import type { CheckAttempt } from '#worker/llm/client.ts';
import type { OutputIssue } from '#worker/llm/types.ts';

/**
 * The Asset drafter's check (P1C.12 A4): every variant through the sanitizer in draft mode
 * (unsafe markup refused, the house format and the look rules), and no variant the same drawing
 * as another or as an approved asset. A repair turn names only the failing variants ("keep the
 * others as they are"); on the last attempt they are soft, so the passing ones come back and the
 * job keeps the refused ones with their problems. Pure.
 */

export const VARIANT_INVALID = 'variant_invalid';
export const VARIANT_DUPLICATE = 'variant_duplicate';

export type VariantVerdict =
  | { readonly ok: true; readonly svg: string; readonly shapes: AssetShape[] }
  | { readonly ok: false; readonly problems: string[] };

/** One variant judged: the sanitizer, then duplicates of `seen` (earlier variants, the library). */
export function judgeVariant(svg: string, seen: ReadonlyMap<string, string>): VariantVerdict {
  const clean = sanitizeAssetSvg(svg, 'draft');
  if (!clean.ok) return { ok: false, problems: clean.problems };
  const same = seen.get(shapeKey(clean.shapes));
  if (same) return { ok: false, problems: [`It is the same drawing as ${same}.`] };
  return { ok: true, svg: clean.svg, shapes: clean.shapes };
}

/** Judges each variant in order; each passing one joins `seen` as "variant <n>". */
export function judgeVariants(
  svgs: readonly string[],
  known: ReadonlyMap<string, string>,
): VariantVerdict[] {
  const seen = new Map(known);
  return svgs.map((svg, i) => {
    const verdict = judgeVariant(svg, seen);
    if (verdict.ok) seen.set(shapeKey(verdict.shapes), `variant ${i + 1}`);
    return verdict;
  });
}

export function assetDraftCheck(known: ReadonlyMap<string, string>) {
  return (value: unknown, attempt: CheckAttempt): OutputIssue[] => {
    const svgs = variantSvgs(value);
    return judgeVariants(
      svgs.map((s) => s ?? ''),
      known,
    ).flatMap((verdict, i) =>
      verdict.ok || svgs[i] === undefined
        ? []
        : verdict.problems.map((problem) => ({
            path: `$.variants[${i}].svg`,
            code: problem.startsWith('It is the same drawing')
              ? VARIANT_DUPLICATE
              : VARIANT_INVALID,
            message: `${problem} Fix variant ${i + 1} only; keep the other variants as they are.`,
            ...(attempt.final ? { soft: true } : {}),
          })),
    );
  };
}

/** The variants' `svg` strings (undefined where an answer has none: the schema reports it). */
function variantSvgs(value: unknown): (string | undefined)[] {
  const variants = (value as { variants?: unknown } | null)?.variants;
  if (!Array.isArray(variants)) return [];
  return variants.map((v) => {
    const svg = (v as { svg?: unknown } | null)?.svg;
    return typeof svg === 'string' ? svg : undefined;
  });
}

/**
 * A drawing's identity for duplicates: its canonical text with every number to one decimal, so a
 * library icon copied at another precision (Lucide's, rounded by draft mode) still matches.
 */
export function shapeKey(shapes: readonly AssetShape[]): string {
  return serializeHouseSvg(shapes).replace(/-?\d+(?:\.\d+)?/g, (n) =>
    String(Math.round(Number(n) * 10) / 10),
  );
}
