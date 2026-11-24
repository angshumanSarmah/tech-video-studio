import {
  FIELD_OWNERS,
  REPAIRABLE_OWNERS,
  type CodeIssue,
  type CuratorIssue,
  type CuratorOwner,
  type Evidence,
  type FixField,
  type GateBadge,
  type PreviousStatus,
  type RenderableVideoSpec,
  type RepairRequest,
} from '@explainer-studio/shared';
import { beatOfPath } from './input.ts';

/**
 * The Curator's repair loop, its pure parts (P1C.8 step 9): which issues a round sends to which
 * agent, the blocking set a round is judged by, how a scoped second-round review merges with the
 * first, and the badges gate 3 shows. A blocking issue is repairable when the Scriptwriter or the
 * Generator owns it and it sits on a beat; the rest (the Director's, the Researcher's, the whole
 * video's) go to the gate as they are.
 */

type Repairable = 'scriptwriter' | 'generator';

const isRepairable = (owner: CuratorOwner): owner is Repairable =>
  REPAIRABLE_OWNERS.includes(owner);

/** The Scriptwriter field a code issue's path points into (`$.script[i].tags` → tags). */
function scriptField(path: string): FixField {
  const field = /^\$\.script\[\d+\]\.([a-zA-Z]+)/.exec(path)?.[1];
  if (field === 'tags' || field === 'headline' || field === 'source') return field;
  if (field === 'statCards') return 'stat_cards';
  return 'narration';
}

const quotesOf = (evidence: readonly Evidence[]) =>
  evidence.flatMap((e) => ('quote' in e && e.quote ? [e.quote] : []));

/** One request per beat and owner, from every repairable blocking issue. */
export function repairRequests(
  spec: RenderableVideoSpec,
  code: readonly CodeIssue[],
  review: readonly CuratorIssue[],
): RepairRequest[] {
  const byKey = new Map<string, RepairRequest>();
  const add = (
    beatId: string,
    owner: Repairable,
    fields: FixField[],
    issue: RepairRequest['issues'][number],
  ) => {
    const key = `${beatId}|${owner}`;
    const current = byKey.get(key) ?? { beatId, owner, fields: [], issues: [] };
    byKey.set(key, {
      ...current,
      fields: [...new Set([...current.fields, ...fields])],
      issues: [...current.issues, issue],
    });
  };
  for (const issue of code) {
    const beatId = beatOfPath(spec, issue.path);
    if (issue.severity !== 'blocking' || !beatId || !isRepairable(issue.owner)) continue;
    const fields: FixField[] = issue.owner === 'generator' ? ['board'] : [scriptField(issue.path)];
    add(beatId, issue.owner, fields, { code: issue.code, message: issue.message });
  }
  for (const issue of review) {
    if (issue.severity !== 'blocking' || !isRepairable(issue.owner)) continue;
    const owner = issue.owner;
    const own = issue.fields.filter((f) => FIELD_OWNERS[f] === owner);
    const fields: FixField[] =
      own.length > 0 ? own : owner === 'generator' ? ['board'] : ['narration'];
    const quotes = quotesOf(issue.evidence);
    add(issue.beatId, owner, fields, {
      code: issue.category,
      message: `${issue.problem} Fix: ${issue.fix}`,
      ...(quotes.length > 0 ? { quotes } : {}),
    });
  }
  return [...byKey.values()];
}

/** `<beat>:<code or category>` of every blocking issue (a beat-less code issue: `:<code>`). */
export function blockingKeys(
  spec: RenderableVideoSpec,
  code: readonly CodeIssue[],
  review: readonly CuratorIssue[],
): string[] {
  const keys = [
    ...code
      .filter((i) => i.severity === 'blocking')
      .map((i) => `${beatOfPath(spec, i.path)}:${i.code}`),
    ...review.filter((i) => i.severity === 'blocking').map((i) => `${i.beatId}:${i.category}`),
  ];
  return [...new Set(keys)].sort();
}

/** Blocking issues per beat (keep-best compares a round's beats by it). */
export function blockingPerBeat(
  spec: RenderableVideoSpec,
  code: readonly CodeIssue[],
  review: readonly CuratorIssue[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (beatId: string) => beatId && counts.set(beatId, (counts.get(beatId) ?? 0) + 1);
  for (const i of code) if (i.severity === 'blocking') bump(beatOfPath(spec, i.path));
  for (const i of review) if (i.severity === 'blocking') bump(i.beatId);
  return counts;
}

/** The earlier round's issues as the next review lists them (`issue-<n>`). */
export const numbered = (issues: readonly CuratorIssue[]) =>
  issues.map((issue, i) => ({ id: `issue-${i + 1}`, issue }));

/**
 * The review after a repair round, scoped: issues on beats the round did not change carry over
 * as they were; on changed beats the new review's issues count, plus an earlier one it marked
 * not_fixed without reporting it again.
 */
export function mergeRoundReview(
  previous: readonly CuratorIssue[],
  round: {
    readonly issues: readonly CuratorIssue[];
    readonly previous?: readonly PreviousStatus[];
  },
  changed: ReadonlySet<string>,
): CuratorIssue[] {
  const status = new Map((round.previous ?? []).map((p) => [p.id, p.status]));
  const carried = previous.filter((issue) => !changed.has(issue.beatId));
  const reopened = numbered(previous)
    .filter(({ id, issue }) => changed.has(issue.beatId) && status.get(id) === 'not_fixed')
    .map(({ issue }) => issue)
    .filter(
      (issue) =>
        !round.issues.some((n) => n.beatId === issue.beatId && n.category === issue.category),
    );
  const fresh = round.issues.filter((issue) => changed.has(issue.beatId));
  return [...carried, ...reopened, ...fresh];
}

/** Every issue left, as gate 3's badges; the Director's and the Researcher's need a plan change. */
export function gateBadges(
  spec: RenderableVideoSpec,
  code: readonly CodeIssue[],
  review: readonly CuratorIssue[],
): GateBadge[] {
  const needsPlanChange = (owner: CuratorOwner) => !isRepairable(owner);
  return [
    ...code.map((i) => {
      const beatId = beatOfPath(spec, i.path);
      return {
        beatId: beatId || null,
        source: 'code' as const,
        code: i.code,
        severity: i.severity,
        owner: i.owner,
        message: i.message,
        needsPlanChange: needsPlanChange(i.owner),
      };
    }),
    ...review.map((i) => ({
      beatId: i.beatId,
      source: 'review' as const,
      code: i.category,
      severity: i.severity,
      owner: i.owner,
      message: `${i.problem} Fix: ${i.fix}`,
      needsPlanChange: needsPlanChange(i.owner),
    })),
  ];
}
