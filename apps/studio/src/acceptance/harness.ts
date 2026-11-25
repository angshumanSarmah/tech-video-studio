import { join } from 'node:path';
import {
  GateDecisionResponseSchema,
  GateDtoSchema,
  SettingsSchema,
  type ApiError,
  type EventDto,
  type GateDecisionRequest,
  type GateDto,
  type RenderableVideoSpec,
  type RunSettingsInput,
  type Settings,
  type VideoSpec,
} from '@explainer-studio/shared';
import { expect } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import type { Executor } from '#core/db/client.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import { getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { advanceRun } from '#core/orchestrator/advance.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { createApp, type App } from '#server/app.ts';
import {
  fixtureResponsesDir,
  fixtureRunSettings,
  fixtureTopic,
  type FixtureTopicId,
} from '#worker/agents/fixture-topics.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { seedRunWithUploads } from '#worker/agents/researcher/testing.ts';
import { createJobHandlers, createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { createLlmClient } from '#worker/llm/client.ts';
import {
  dryRunTransport,
  loadDryRunFixtures,
  recordedInOrder,
  type DryRunResponse,
} from '#worker/llm/dry-run.ts';
import type { LlmTransport } from '#worker/llm/types.ts';
import { fakeTools } from '#worker/render/testing.ts';
import { fixtureTts } from '#worker/repair/testing.ts';
import { runNextJob } from '#worker/runner.ts';

/**
 * The acceptance tests' world (P1C.9): a test DB, the HTTP API over it, and a dry-run worker
 * built per `drain` from a fixture topic's recordings plus whatever a test appends (a Curator
 * review, a regenerate's answers). The committed Kokoro timing (`fixtureTts`) and a fake
 * renderer whose requests each drain keeps. Not imported by any entrypoint.
 */

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));

/** Answers a drain replays after (or, for the Curator, instead of) the topic's recordings. */
export interface Answers {
  readonly researcher?: readonly DryRunResponse[];
  readonly director?: readonly DryRunResponse[];
  readonly scriptwriter?: readonly DryRunResponse[];
  /** Per beat (the Generator's replay key). */
  readonly generator?: Readonly<Record<string, readonly DryRunResponse[]>>;
  readonly curator?: readonly DryRunResponse[];
}

export class Harness {
  readonly t: TestDb = createTestDb();
  settings: Settings = SettingsSchema.parse({});
  readonly app: App = createApp({
    db: this.t.db,
    dataDir: this.t.dataDir,
    appSettings: () => this.settings,
  });
  /** The last drain's fake renderer requests. */
  renders = fakeTools().engine;

  constructor(readonly topic: FixtureTopicId) {}

  cleanup(): void {
    this.t.cleanup();
  }

  /**
   * The replay queues, per role (the Generator's per beat), kept across drains: a drain appends
   * its answers, so a rerun replays what the test gave it, not the recordings again.
   */
  private readonly queues = new Map<string, DryRunResponse[]>();

  private enqueue(answers: Answers): void {
    if (this.queues.size === 0) this.loadRecordings();
    const push = (key: string, list: readonly DryRunResponse[] = []) =>
      this.queues.set(key, [...(this.queues.get(key) ?? []), ...list]);
    for (const role of ['researcher', 'director', 'scriptwriter', 'curator'] as const) {
      push(role, answers[role]);
    }
    for (const [beat, list] of Object.entries(answers.generator ?? {})) {
      push(`generator:${beat}`, list);
    }
  }

  /** The topic's recorded answers for a role (to replay a rerun of it). */
  recording(role: 'researcher' | 'director' | 'scriptwriter'): DryRunResponse[] {
    return [...recordedInOrder(fixtureResponsesDir(role, this.topic), role)];
  }

  /** The Generator's recorded boards, per beat. */
  recordedBoards(): Record<string, DryRunResponse[]> {
    return loadDryRunFixtures(fixtureResponsesDir('generator', this.topic)).generator as Record<
      string,
      DryRunResponse[]
    >;
  }

  private loadRecordings(): void {
    for (const role of ['researcher', 'director', 'scriptwriter'] as const) {
      this.queues.set(role, [...recordedInOrder(fixtureResponsesDir(role, this.topic), role)]);
    }
    const keyed = loadDryRunFixtures(fixtureResponsesDir('generator', this.topic)).generator;
    for (const [beat, list] of Object.entries(keyed as Record<string, DryRunResponse[]>)) {
      this.queues.set(`generator:${beat}`, [...list]);
    }
  }

  /** Replays the next queued answer for the call's role (and beat). */
  private readonly transport: LlmTransport = {
    send: (request) => {
      const keyed = request.role === 'generator';
      const next = this.queues
        .get(keyed ? `generator:${request.replayKey}` : request.role)
        ?.shift();
      const fixtures = keyed
        ? { generator: { [request.replayKey ?? '']: next ? [next] : [] } }
        : { [request.role]: next ? [next] : [] };
      return dryRunTransport(fixtures).send(request);
    },
  };

  worker(answers: Answers = {}): JobRegistry {
    const { t, topic } = this;
    this.enqueue(answers);
    const llm = createLlmClient({
      db: t.db,
      dataDir: t.dataDir,
      llm: this.settings.llm,
      transport: this.transport,
    });
    const tts = fixtureTts(topic, join(t.dataDir, 'fake-tts')).provider;
    const { tools, engine } = fakeTools();
    this.renders = engine;
    return createJobRegistry(
      createJobHandlers({ db: t.db, dataDir: t.dataDir, tools, tts, llm, prompts }),
    );
  }

  /** Runs jobs as the worker does (the orchestrator queues each next one), at most `limit`. */
  async drain(answers: Answers = {}, limit = Infinity): Promise<void> {
    const registry = this.worker(answers);
    const signal = new AbortController().signal;
    const advance = (tx: Executor, runId: number) => advanceRun(tx, this.t.dataDir, runId);
    for (let i = 0; i < limit; i += 1) {
      const ran = await runNextJob({ db: this.t.db, registry, workerId: 't', signal, advance });
      if (!ran) return;
    }
  }

  /** The topic's run with these settings (its pace pinned to the recordings'), not yet run. */
  start(settings: RunSettingsInput = {}): number {
    const { topic, sourceFiles, seriesTag } = fixtureTopic(this.topic);
    return seedRunWithUploads(this.t.db, this.t.dataDir, topic, sourceFiles, {
      seriesTag,
      settings: fixtureRunSettings(settings),
    }).runId;
  }

  /** A run with these gates on auto, run until it waits. */
  async runUntilWaiting(autoApprove: Record<string, boolean>, answers?: Answers): Promise<number> {
    const runId = this.start({ autoApprove });
    await this.drain(answers);
    return runId;
  }

  async gate(runId: number, gate: string): Promise<GateDto> {
    const res = await this.app.request(`/api/runs/${runId}/gates/${gate}`);
    expect(res.status).toBe(200);
    return GateDtoSchema.parse(await res.json());
  }

  post(runId: number, gate: string, body: GateDecisionRequest): Promise<Response> {
    return Promise.resolve(
      this.app.request(`/api/runs/${runId}/gates/${gate}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  putSettings(runId: number, settings: unknown): Promise<Response> {
    return Promise.resolve(
      this.app.request(`/api/runs/${runId}/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings }),
      }),
    );
  }

  jobs(runId: number): string[] {
    return listRunJobs(this.t.db, runId).map((j) => j.type);
  }

  events(runId: number): EventDto[] {
    return listEventsSince(this.t.db, { runId, afterId: 0, limit: 10_000 }).map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  logs(runId: number): string[] {
    return this.events(runId).flatMap((e) => (e.type === 'log' ? [e.payload.message] : []));
  }

  /** The steps the run entered after event `afterId`, in order (a step once, however long). */
  stepsAfter(runId: number, afterId: number): string[] {
    const steps = this.events(runId).flatMap((e) =>
      e.id > afterId && e.type === 'run_status' && e.payload.step ? [e.payload.step] : [],
    );
    return steps.filter((step, i) => step !== steps[i - 1]);
  }

  lastEventId(runId: number): number {
    return this.events(runId).at(-1)?.id ?? 0;
  }

  spec(specVersionId: number): RenderableVideoSpec {
    const version = getSpecVersion(this.t.db, specVersionId)!;
    return readDataJson(this.t.dataDir, version.jsonPath) as RenderableVideoSpec;
  }
}

export async function decided(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  return GateDecisionResponseSchema.parse(await res.json());
}

export async function expectError(res: Response, status: number): Promise<ApiError['error']> {
  expect(res.status, await res.clone().text()).toBe(status);
  return ((await res.json()) as ApiError).error;
}

/** The gate payload's spec (scenes, draft). */
export const gateSpec = (gate: GateDto): VideoSpec => (gate.content as { spec: VideoSpec }).spec;
