import type { RunSettingsSource } from '@explainer-studio/shared';
import type { Db } from '../db/client.ts';
import { decideGate, openGate } from '../db/repositories/gates.ts';
import { createRun, type Run } from '../db/repositories/runs.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { advanceRun, moveTo } from '../orchestrator/advance.ts';
import { requireRun } from '../orchestrator/snapshot.ts';
import { saveSpecVersionIn } from './spec-versions.ts';

/**
 * A saved spec rendered with no LLM calls (`studio render`, P1C.9b): a scratch topic and run,
 * the spec as its version 1 (`external`), its scenes gate approved on it, and the run sent to the
 * draft step, so the usual pipeline renders it: the draft and the stills, then gate 4 (which
 * approves itself for `final` when nothing blocks the final), then the final and its export.
 */

export interface RenderRunInput {
  readonly spec: unknown;
  /** Where the spec came from (its file name): the topic title and the version's label. */
  readonly label: string;
  readonly seriesId: number;
  readonly final: boolean;
  readonly app: RunSettingsSource;
}

export function startRenderRun(db: Db, dataDir: string, input: RenderRunInput): Run {
  return db.transaction((tx) => {
    const topic = createTopic(tx, { title: `render: ${input.label}` });
    const run = createRun(tx, {
      topicId: topic.id,
      seriesId: input.seriesId,
      settings: {
        autoApprove: { research: false, beat_sheet: false, scenes: false, draft: input.final },
      },
      app: input.app,
    });
    const { version } = saveSpecVersionIn(tx, dataDir, {
      runId: run.id,
      spec: input.spec,
      createdBy: 'external',
      sourceLabel: input.label,
    });
    openGate(tx, run.id, 'scenes', { specVersionId: version.id });
    decideGate(tx, run.id, 'scenes', {
      status: 'approved',
      decidedBy: 'user',
      notes: `studio render ${input.label}`,
    });
    moveTo(tx, run, 'draft');
    advanceRun(tx, dataDir, run.id);
    return requireRun(tx, run.id);
  });
}
