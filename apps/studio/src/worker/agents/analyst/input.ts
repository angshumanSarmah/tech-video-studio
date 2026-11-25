import type {
  EditDiff,
  GateDecisionRecord,
  GateId,
  MemoryRuleScope,
  MemoryRuleStatus,
} from '@explainer-studio/shared';

/**
 * The Analyst's run input (P1C.10), the user message: the video, the gate and the decision, the
 * note, what the decision concerns (an edit's changes, the beat a regenerate names) and the
 * rules there are. Pure; `context.ts` reads it from the run's files.
 */

export interface AnalystInput {
  readonly gate: GateId;
  readonly decision: GateDecisionRecord & { readonly note: string };
  readonly topic: { readonly title: string; readonly notes: string | null };
  /** An edit's changes, by JSON path. */
  readonly changes?: EditDiff;
  /**
   * The beat a regenerate names, as it was: its plan intent and script, and its board as text
   * (the Curator's board description) when the subject has boards.
   */
  readonly beat?: {
    readonly id: string;
    readonly content: unknown;
    readonly board?: readonly string[];
  };
  readonly existingRules: readonly {
    readonly id: number;
    readonly scope: MemoryRuleScope;
    readonly status: MemoryRuleStatus;
    readonly text: string;
  }[];
}

const GATE_TITLES: Readonly<Record<GateId, string>> = {
  research: 'gate 1: research notes (facts, numbers, sources)',
  beat_sheet: 'gate 2: beat sheet (the plan: hook, beats, devices, patterns)',
  scenes: 'gate 3: scenes (narration, headlines, tags and boards per beat)',
  draft: 'gate 4: draft video (the rendered video)',
};

const INTRO =
  'A reviewer left this note at a review gate. Decide whether it shows one standing preference ' +
  'that would have prevented the problem in other videos too, and answer with the output shape.';

export function analystUserMessage(input: AnalystInput): string {
  return [
    INTRO,
    section('VIDEO', [
      `topic: ${input.topic.title}`,
      ...(input.topic.notes ? [`angle: ${input.topic.notes}`] : []),
    ]),
    section('GATE AND DECISION', [GATE_TITLES[input.gate], `decision: ${decisionLine(input)}`]),
    section('NOTE', [input.decision.note]),
    ...(input.changes ? [changesSection(input.changes)] : []),
    ...(input.beat
      ? [
          section(`THE BEAT IT CONCERNS (${input.beat.id}, before the decision)`, [
            JSON.stringify(input.beat.content, null, 2),
            ...(input.beat.board ?? []),
          ]),
        ]
      : []),
    section(
      'EXISTING RULES (do not repeat or contradict these; cite one by id)',
      rulesLines(input),
    ),
  ].join('\n\n');
}

function section(title: string, lines: readonly string[]): string {
  return [`## ${title}`, ...lines].join('\n');
}

function decisionLine({ decision }: AnalystInput): string {
  switch (decision.action) {
    case 'approve':
      return 'approve (the reviewer passed it, with this note)';
    case 'reject':
      return 'reject (the reviewer stopped the video)';
    case 'edit':
      return 'edit (the reviewer changed it by hand; the changes are below)';
    case 'regenerate': {
      const what = [
        decision.target ? `target ${decision.target}` : undefined,
        decision.beatId ? `beat ${decision.beatId}` : undefined,
        decision.fields?.length ? `fields ${decision.fields.join(', ')}` : undefined,
      ].filter(Boolean);
      return `regenerate (asked an agent to do it again${what.length ? `: ${what.join(', ')}` : ''})`;
    }
  }
}

function changesSection({ changes, omitted }: EditDiff): string {
  const lines = changes.map((c) => {
    if (c.before === undefined) return `- ${c.path}: added ${c.after ?? ''}`;
    if (c.after === undefined) return `- ${c.path}: removed ${c.before}`;
    return `- ${c.path}: ${c.before} → ${c.after}`;
  });
  return section('WHAT THE REVIEWER CHANGED (JSON path: before → after)', [
    ...(lines.length > 0 ? lines : ['(nothing: the edit saved the same content)']),
    ...(omitted > 0 ? [`(${omitted} more changes left out)`] : []),
  ]);
}

function rulesLines({ existingRules }: AnalystInput): string[] {
  if (existingRules.length === 0) return ['(none)'];
  return existingRules.map((r) => `- rule ${r.id} [${r.scope}, ${r.status}]: ${r.text}`);
}
