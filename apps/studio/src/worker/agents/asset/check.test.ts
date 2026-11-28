import { SEED_ASSETS } from '@explainer-studio/renderer/catalog';
import { describe, expect, it } from 'vitest';
import { assetDraftCheck, judgeVariants, shapeKey } from './check.ts';
import { DRAFT_SVGS, HEX_SVG, SCRIPT_SVG } from './testing.ts';

const library = new Map(SEED_ASSETS.map((a) => [shapeKey(a.shapes), `approved asset ${a.id}`]));
const answer = (svgs: readonly string[]) => ({
  variants: svgs.map((svg, i) => ({ concept: `idea ${i + 1}`, svg })),
});

describe('the Asset drafter check', () => {
  it('passes three distinct house drawings', () => {
    expect(judgeVariants(DRAFT_SVGS, library).map((v) => v.ok)).toEqual([true, true, true]);
    expect(assetDraftCheck(library)(answer(DRAFT_SVGS), { final: false })).toEqual([]);
  });

  it('names only the failing variant, and keeps the others', () => {
    const issues = assetDraftCheck(library)(answer([DRAFT_SVGS[0], HEX_SVG, DRAFT_SVGS[2]]), {
      final: false,
    });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue).toMatchObject({ path: '$.variants[1].svg', code: 'variant_invalid' });
      expect(issue.message).toMatch(/Fix variant 2 only; keep the other variants as they are\.$/);
      expect(issue.soft).toBeUndefined();
    }
  });

  it('refuses unsafe markup, and marks failures soft on the last attempt', () => {
    const [issue] = assetDraftCheck(library)(answer([SCRIPT_SVG, ...DRAFT_SVGS.slice(1)]), {
      final: true,
    });
    expect(issue).toMatchObject({ path: '$.variants[0].svg', soft: true });
    expect(issue?.message).toMatch(/^Refused/);
  });

  it('refuses a variant that repeats another, or an approved asset at another precision', () => {
    const server = SEED_ASSETS.find((a) => a.id === 'server')!;
    const copy = SEED_ASSETS.find((a) => a.id === 'server')!.shapes.map((s) => ({
      ...s,
      attrs: Object.fromEntries(
        Object.entries(s.attrs).map(([k, v]) => [
          k,
          v.replace(/\d+(?:\.\d+)?/g, (n) => String(Number(n) + 0.004)),
        ]),
      ),
    }));
    expect(shapeKey(copy)).toBe(shapeKey(server.shapes));
    const verdicts = judgeVariants([DRAFT_SVGS[0], DRAFT_SVGS[0]], library);
    expect(verdicts[1]).toEqual({ ok: false, problems: ['It is the same drawing as variant 1.'] });
    const issues = assetDraftCheck(library)(answer([DRAFT_SVGS[0], DRAFT_SVGS[0]]), {
      final: false,
    });
    expect(issues).toMatchObject([{ path: '$.variants[1].svg', code: 'variant_duplicate' }]);
  });

  it('accepts any JSON (the schema reports what is missing)', () => {
    const check = assetDraftCheck(library);
    expect(check(null, { final: false })).toEqual([]);
    expect(check({ variants: [{ concept: 'x' }] }, { final: false })).toEqual([]);
  });
});
