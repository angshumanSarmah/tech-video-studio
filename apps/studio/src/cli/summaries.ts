import { join } from 'node:path';
import type { GateId, VideoSpec } from '@explainer-studio/shared';
import type { GateView } from '#core/services/gates.ts';

/**
 * Gate summaries for the terminal (P1C.9b), pure: what the gate reviews in a few lines, what
 * blocks it, and the run's cost. G1: notes counts, each source's length and chunks, failures and
 * disagreements; G2: a beat table; G3: each beat's narration and badges, and the stills; G4: the
 * draft and the stills. Paths are absolute (`dataDir`).
 */

const WIDTH = 96;

const GATE_TITLES: Readonly<Record<GateId, string>> = {
  research: 'research notes',
  beat_sheet: 'beat sheet',
  scenes: 'scenes',
  draft: 'draft',
};

const GATE_NUMBERS: Readonly<Record<GateId, number>> = {
  research: 1,
  beat_sheet: 2,
  scenes: 3,
  draft: 4,
};

export const gateNumber = (gate: GateId): number => GATE_NUMBERS[gate];

export function gateSummary(view: GateView, dataDir: string): string[] {
  const lines = [
    `── Gate ${gateNumber(view.gate)}: ${GATE_TITLES[view.gate]} · run ${view.runId} ──`,
  ];
  lines.push(...contentLines(view, dataDir));
  if (view.blocking.length > 0) {
    lines.push('Blocking (it does not approve itself):');
    lines.push(...view.blocking.map((b) => `  ✗ ${clip(b, WIDTH)}`));
  }
  lines.push(...view.warnings.map((w) => `  ! ${clip(w.message, WIDTH)}`));
  lines.push(costLine(view));
  return lines;
}

function contentLines(view: GateView, dataDir: string): string[] {
  const content = view.content;
  if (!content) return ['(nothing to review yet)'];
  switch (content.gate) {
    case 'research':
      return [...researchLines(content.notes, content.sources), ...checkLines(view)];
    case 'beat_sheet':
      return [...planLines(content.plan), ...checkLines(view)];
    case 'scenes':
      return [...beatLines(content.spec, view), ...stillLines(view, dataDir)];
    case 'draft':
      return [
        `Draft: ${view.draftPath ? join(dataDir, view.draftPath) : '(not rendered yet)'}`,
        ...stillLines(view, dataDir),
        ...badgeLines(view, null),
      ];
  }
}

type ResearchContent = Extract<NonNullable<GateView['content']>, { gate: 'research' }>;
type PlanContent = Extract<NonNullable<GateView['content']>, { gate: 'beat_sheet' }>;

function researchLines(
  notes: ResearchContent['notes'],
  sources: ResearchContent['sources'],
): string[] {
  const disputed = notes.openQuestions.filter((q) => q.reason === 'disagreement').length;
  return [
    `${notes.facts.length} facts · ${notes.numbers.length} numbers · ${notes.glossary.length} terms · ` +
      `${notes.openQuestions.length} open questions (${disputed} ${disputed === 1 ? 'disagreement' : 'disagreements'})`,
    'Sources:',
    ...sources.map((s) => {
      const head = `  #${s.sourceId} ${s.kind.padEnd(4)} ${clip(s.origin, 52).padEnd(52)}`;
      if (!s.read) return `${head} FAILED: ${clip(s.error ?? '', 60)}`;
      const chars = s.read.chars.toLocaleString('en-US').padStart(8);
      return `${head} ${chars} chars ${s.read.sentChunks}/${s.read.chunks} chunks`;
    }),
  ];
}

function planLines(plan: PlanContent['plan']): string[] {
  const length = plan.meta.targetLengthSec ? `${plan.meta.targetLengthSec} s` : 'per part';
  return [
    `"${plan.meta.title}" · ${plan.meta.topicClass} · ${plan.meta.format ?? 'full'} · ${length}`,
    ...(plan.parts ?? []).map(
      (p) => `  part ${p.part}: ${p.title} (${p.beatIds.join(', ')}, ${p.targetLengthSec} s)`,
    ),
    'Beats:',
    ...plan.story.beats.map(
      (b) =>
        `  ${b.id.padEnd(8)} ${(b.device ?? '-').padEnd(20)} ${(b.layoutMode ?? '-').padEnd(16)} ` +
        `${String(b.targetSec).padStart(3)} s  ${clip(b.intent, 44)}`,
    ),
    ...plan.story.missingPrimitiveRequests.map(
      (r) => `  missing primitive: ${r.name} (fallback ${r.fallbackUsed})`,
    ),
  ];
}

function beatLines(spec: VideoSpec, view: GateView): string[] {
  const lines = [`"${spec.meta.title}" · ${spec.story.beats.length} beats`];
  for (const beat of spec.script ?? []) {
    const timed = spec.timing?.beats.find((b) => b.beatId === beat.beatId);
    const length = timed ? ` (${(timed.endSec - timed.startSec).toFixed(1)} s)` : '';
    lines.push(`  ${beat.beatId}${length}: ${clip(beat.narration, WIDTH - 12)}`);
    lines.push(...badgeLines(view, beat.beatId));
  }
  lines.push(...badgeLines(view, null));
  return lines;
}

function badgeLines(view: GateView, beatId: string | null): string[] {
  return view.badges
    .filter((b) => b.beatId === beatId)
    .map(
      (b) =>
        `    ${b.severity === 'blocking' ? '✗' : '·'} ${b.code}: ${clip(b.message, WIDTH - 10)}`,
    );
}

function stillLines(view: GateView, dataDir: string): string[] {
  const first = view.stills[0];
  if (!first) return [];
  return [`Stills (${view.stills.length}): ${join(dataDir, first.path, '..')}`];
}

function checkLines(view: GateView): string[] {
  if (view.checks.length === 0) return [];
  return [
    'Checks:',
    ...view.checks.map((c) => `  · ${c.code} at ${c.path}: ${clip(c.message, 70)}`),
  ];
}

function costLine(view: GateView): string {
  const roles = view.cost.byRole.map((r) => `${r.role} $${r.costUsd.toFixed(4)}`).join(' · ');
  return `Cost so far: $${view.cost.totalUsd.toFixed(4)}${roles ? ` (${roles})` : ''}`;
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The exact commands that continue from a gate (no terminal, or the user quit). */
export function gateCommands(runId: number, gate: GateId, editFile: string): string[] {
  const studio = `pnpm studio gate ${runId}`;
  const change = '--feedback "<what to change>"';
  const regenerate =
    gate === 'research'
      ? [`${studio} regenerate --target researcher ${change}`]
      : gate === 'beat_sheet'
        ? [`${studio} regenerate --target director ${change}`]
        : [
            `${studio} regenerate --beat <beat id> [--fields narration,board] ${change}`,
            `${studio} regenerate --target scriptwriter|generator [${change}]`,
          ];
  return [
    `Waiting at gate ${gateNumber(gate)} (${GATE_TITLES[gate]}). Continue with one of:`,
    `  ${studio} approve`,
    ...regenerate.map((c) => `  ${c}`),
    `  ${studio} edit ${editFile}`,
    `  ${studio} reject [--notes "<why>"]`,
  ];
}
