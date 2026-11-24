import { narrationSentences } from '../spec/narration.ts';
import { isRecord, problem, text, type Json } from './review-helpers.ts';
import {
  curatorIssueProblems,
  quoteFound,
  type ReviewBeatTexts,
  type ReviewCheckContext,
  type ReviewProblem,
} from './review-checks.ts';
import { PASS_CATEGORIES, REVIEW_CATEGORIES, type ReviewPass } from './review.ts';

/**
 * Checks on one review pass's answer (P1C.8: the two-pass review). Both passes: every issue is
 * verified (`curatorIssueProblems`) and must be of the pass's categories (`PASS_CATEGORIES`).
 * PASS claims also: every narration sentence of every beat is listed (`claim_missing`, the
 * coverage a repair turn restores), and every element a beat adds that shows a research number
 * (`label_claim_missing`); each listed claim is in its beat as written; `supported` gives the
 * ids that state it, and they exist; `issue` has an issue on its beat that quotes it. Takes any
 * JSON value, like every `callJson` check. Pure.
 */
export function reviewPassProblems(
  pass: ReviewPass,
  value: unknown,
  ctx: ReviewCheckContext,
): ReviewProblem[] {
  if (!isRecord(value)) return [];
  const issues = Array.isArray(value.issues) ? value.issues.filter(isRecord) : [];
  return [
    ...curatorIssueProblems(value, ctx),
    ...issues.flatMap((issue, i) => categoryInPass(pass, issue, i)),
    ...(pass === 'claims' ? claimsProblems(value, issues, ctx) : []),
  ];
}

function categoryInPass(pass: ReviewPass, issue: Json, i: number): ReviewProblem[] {
  const category = REVIEW_CATEGORIES.find((c) => c === issue.category);
  if (!category || PASS_CATEGORIES[pass].includes(category)) return [];
  return [
    problem(
      ['issues', i, 'category'],
      'category_not_in_pass',
      `${category} belongs to the other pass. In PASS ${pass} report only ` +
        `${PASS_CATEGORIES[pass].join(', ')}.`,
    ),
  ];
}

function claimsProblems(
  value: Json,
  issues: readonly Json[],
  ctx: ReviewCheckContext,
): ReviewProblem[] {
  const claims = Array.isArray(value.claims) ? value.claims.filter(isRecord) : [];
  return [
    ...ctx.beats.flatMap((beat) => coverageProblems(beat, claims)),
    ...claims.flatMap((claim, j) => claimProblems(claim, j, issues, ctx)),
  ];
}

const listed = (claims: readonly Json[], beatId: string, source: string) =>
  claims.filter((c) => c.beatId === beatId && c.source === source);

/** Each sentence and each numeric label of the beat, listed. */
function coverageProblems(beat: ReviewBeatTexts, claims: readonly Json[]): ReviewProblem[] {
  const said = listed(claims, beat.beatId, 'narration').flatMap((c) => text(c.text) ?? []);
  const sentences = narrationSentences(beat.narration).flatMap((sentence) =>
    said.some((t) => quoteFound(sentence, [t]))
      ? []
      : [
          problem(
            ['claims'],
            'claim_missing',
            `${beat.beatId}'s sentence "${sentence}" is not listed. List every narration ` +
              'sentence of every beat, in order, copied exactly (verdict no_claim when it states ' +
              'no fact or number).',
          ),
        ],
  );
  const labelled = new Set(listed(claims, beat.beatId, 'label').map((c) => c.elementId));
  const labels = (beat.numberLabels ?? []).flatMap((id) =>
    labelled.has(id)
      ? []
      : [
          problem(
            ['claims'],
            'label_claim_missing',
            `${beat.beatId}'s board element "${id}" shows a research number but is not listed. ` +
              'List it (source label, its elementId, one of its texts or values) with the ids ' +
              'whose meaning it shows, or an issue.',
          ),
        ],
  );
  return [...sentences, ...labels];
}

function claimProblems(
  claim: Json,
  j: number,
  issues: readonly Json[],
  ctx: ReviewCheckContext,
): ReviewProblem[] {
  const beat = ctx.beats.find((b) => b.beatId === claim.beatId);
  const claimText = text(claim.text) ?? '';
  if (!beat) {
    return [
      problem(
        ['claims', j, 'beatId'],
        'unknown_beat',
        `There is no beat "${String(claim.beatId)}".`,
      ),
    ];
  }
  return [
    ...claimTextProblems(claim, j, beat, claimText),
    ...verdictProblems(claim, j, issues, ctx, claimText),
  ];
}

function claimTextProblems(
  claim: Json,
  j: number,
  beat: ReviewBeatTexts,
  claimText: string,
): ReviewProblem[] {
  if (claim.source === 'label') {
    const id = text(claim.elementId) ?? '';
    const texts = beat.labels[id];
    if (!texts) {
      return [
        problem(
          ['claims', j, 'elementId'],
          'unknown_element',
          `"${id}" is not on ${beat.beatId}'s board.`,
        ),
      ];
    }
    return quoteFound(claimText, texts)
      ? []
      : [
          notFound(
            j,
            claimText,
            `${id}'s texts and values (${texts.map((t) => `"${t}"`).join(', ')})`,
          ),
        ];
  }
  return quoteFound(claimText, [beat.narration])
    ? []
    : [notFound(j, claimText, `${beat.beatId}'s narration`)];
}

const notFound = (j: number, claimText: string, where: string) =>
  problem(
    ['claims', j, 'text'],
    'quote_not_found',
    `"${claimText}" is not in ${where}. Copy it exactly as the input gives it.`,
  );

function verdictProblems(
  claim: Json,
  j: number,
  issues: readonly Json[],
  ctx: ReviewCheckContext,
  claimText: string,
): ReviewProblem[] {
  const ids = Array.isArray(claim.ids) ? claim.ids.flatMap((id) => text(id) ?? []) : [];
  if (claim.verdict === 'supported') {
    if (ids.length === 0) {
      return [
        problem(
          ['claims', j, 'ids'],
          'claim_ids_missing',
          'A supported claim names the fact or number ids that state it; if none does, its ' +
            'verdict is issue (with an unsupported_claim issue) or no_claim.',
        ),
      ];
    }
    const known = new Set([
      ...ctx.notes.facts.map((f) => f.id),
      ...ctx.notes.numbers.map((n) => n.id),
    ]);
    return ids.flatMap((id, k) =>
      known.has(id)
        ? []
        : [
            problem(
              ['claims', j, 'ids', k],
              'unknown_research_id',
              `"${id}" is not in the notes. Use "fact-<n>" and "num-<n>" ids the notes give.`,
            ),
          ],
    );
  }
  if (claim.verdict !== 'issue') return [];
  return issues.some((issue) => quotesClaim(issue, claim, claimText))
    ? []
    : [
        problem(
          ['claims', j, 'verdict'],
          'claim_issue_missing',
          `"${claimText}" has verdict issue, but no issue on ${String(claim.beatId)} quotes it. ` +
            'Report the issue under issues, or give the claim its supporting ids.',
        ),
      ];
}

/** An issue on the claim's beat whose evidence quotes the claim (or names its element). */
function quotesClaim(issue: Json, claim: Json, claimText: string): boolean {
  if (issue.beatId !== claim.beatId || !Array.isArray(issue.evidence)) return false;
  return issue.evidence.filter(isRecord).some((e) => {
    if (claim.source === 'label' && e.kind === 'label' && e.elementId === claim.elementId) {
      return true;
    }
    const quote = text(e.quote);
    return (
      quote !== undefined && (quoteFound(quote, [claimText]) || quoteFound(claimText, [quote]))
    );
  });
}
