import { numberKey, numberMentions } from '../script/number-mentions.ts';
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
 * coverage a repair turn restores), and every value an element a beat adds draws, one entry each
 * with its label (`value_claim_missing`: a counter's start and end are two); each listed claim
 * is in its beat as written, a value's label among its element's texts; `supported` gives the
 * ids that state it, they exist, and it restates the claim's and the fact's subject and verb
 * (`claim_restatement_missing`); `issue` has an issue on its beat that quotes it. Takes any
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

/** Each sentence and each drawn value of the beat, listed. */
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
  const entries = listed(claims, beat.beatId, 'value');
  const values = (beat.drawnValues ?? []).flatMap((drawn) =>
    entries.some((c) => c.elementId === drawn.elementId && statesValue(c, drawn.valueKey))
      ? []
      : [
          problem(
            ['claims'],
            'value_claim_missing',
            `${beat.beatId}'s element "${drawn.elementId}" draws ${drawn.value} (${drawn.key}) ` +
              'but it is not listed. Give it its own entry (source value, its elementId, the ' +
              'value as drawn, the label it is read with) with the ids whose meaning it shows, ' +
              'or an issue.',
          ),
        ],
  );
  return [...sentences, ...values];
}

/** Whether a value entry's text states the value. */
function statesValue(claim: Json, valueKey: string): boolean {
  return numberMentions(text(claim.text) ?? '').some((m) => numberKey(m.value) === valueKey);
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
  if (claim.source === 'value') {
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
    const where = `${id}'s texts and values (${texts.map((t) => `"${t}"`).join(', ')})`;
    const label = text(claim.label);
    return [
      ...(quoteFound(claimText, texts) ? [] : [notFound(j, claimText, where)]),
      ...(label === undefined || quoteFound(label, texts)
        ? []
        : [
            problem(
              ['claims', j, 'label'],
              'quote_not_found',
              `"${label}" is not among ${where}. Copy the label the value is read with.`,
            ),
          ]),
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
    if (!restates(claim)) {
      return [
        problem(
          ['claims', j, 'restates'],
          'claim_restatement_missing',
          'A supported claim restates who does what in it and in its fact (restates.claim, ' +
            'restates.fact), so a reversed claim ("bills" against "is billed") shows.',
        ),
      ];
    }
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

function restates(claim: Json): boolean {
  const r = claim.restates;
  return isRecord(r) && text(r.claim) !== undefined && text(r.fact) !== undefined;
}

/** An issue on the claim's beat whose evidence quotes the claim (or names its element). */
function quotesClaim(issue: Json, claim: Json, claimText: string): boolean {
  if (issue.beatId !== claim.beatId || !Array.isArray(issue.evidence)) return false;
  return issue.evidence.filter(isRecord).some((e) => {
    if (claim.source === 'value' && e.kind === 'label' && e.elementId === claim.elementId) {
      return true;
    }
    const quote = text(e.quote);
    return (
      quote !== undefined && (quoteFound(quote, [claimText]) || quoteFound(claimText, [quote]))
    );
  });
}
