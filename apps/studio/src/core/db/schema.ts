/**
 * SQLite schema. Enum columns take their values from the Zod enums in `@explainer-studio/shared`;
 * they are validated in the app, not by CHECK constraints.
 *
 * Large JSON and text never live in the DB: columns ending in `_path` hold paths relative to the
 * data dir (see `#core/data-files.ts`).
 */
import {
  ASSET_FAMILIES,
  ASSET_STATUSES,
  BACKLOG_STATUSES,
  DECIDED_BY,
  EVENT_TYPES,
  GATE_IDS,
  GATE_STATUSES,
  JOB_STATUSES,
  MEMORY_RULE_SCOPES,
  MEMORY_RULE_STATUSES,
  MODEL_ROLES,
  PIPELINE_STEP_IDS,
  RUN_STATUSES,
  SOURCE_FAILURE_CODES,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  SPEC_AUTHORS,
  STAGES,
  STEP_STATUSES,
  USAGE_KINDS,
  WORKER_KINDS,
  LLM_MODES,
  type EventBody,
  type NormalizerFix,
  type ResolvedRunSettings,
  type RunSettings,
  type StepRequests,
} from '@explainer-studio/shared';
import { sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });

/** Epoch milliseconds, read as `Date`. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);

const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
    .$onUpdateFn(() => new Date());

const jsonStringArray = (name: string) =>
  text(name, { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`);

// ---------------------------------------------------------------------------------------------
// Channel and series

export const channels = sqliteTable('channels', {
  id: id(),
  name: text('name').notNull(),
  handle: text('handle'),
  createdAt: createdAt(),
});

export const series = sqliteTable(
  'series',
  {
    id: id(),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Stable slug, unique across channels (e.g. `system-design`). */
    tag: text('tag').notNull(),
    /** Display text for the video HUD (e.g. `SYSTEM DESIGN`). */
    label: text('label').notNull(),
    accentColour: text('accent_colour').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('series_tag_uq').on(t.tag), index('series_channel_idx').on(t.channelId)],
);

// ---------------------------------------------------------------------------------------------
// Topics and sources

export const topics = sqliteTable('topics', {
  id: id(),
  title: text('title').notNull(),
  notes: text('notes'),
  createdAt: createdAt(),
});

/**
 * Extracted text is content-addressed on disk (`topics/<t>/sources/<s>/<hash>.txt`), so a re-fetch
 * adds a file instead of overwriting the version older runs used.
 */
export const sources = sqliteTable(
  'sources',
  {
    id: id(),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SOURCE_KINDS }).notNull(),
    url: text('url'),
    /** Uploaded original, or the pasted text (`kind: 'text'`), relative to the data dir. */
    filePath: text('file_path'),
    status: text('status', { enum: SOURCE_STATUSES }).notNull().default('pending'),
    /** Latest extracted text, relative to the data dir. */
    textPath: text('text_path'),
    /** sha256 (hex) of the latest extracted text. */
    contentHash: text('content_hash'),
    /**
     * Page or document title (HTML title, PDF title, first heading, else the file name); a
     * pasted text's title is given with it and kept.
     */
    title: text('title'),
    /** Why the latest ingestion failed, written for the user (what to do instead). */
    error: text('error'),
    errorCode: text('error_code', { enum: SOURCE_FAILURE_CODES }),
    /** When the latest text was fetched (URL) or read (file): the source's "as of" date. */
    extractedAt: timestamp('extracted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sources_topic_idx').on(t.topicId),
    check(
      'sources_kind_ck',
      sql`(${t.kind} = 'url' and ${t.url} is not null and ${t.filePath} is null) or (${t.kind} in ('file', 'text') and ${t.filePath} is not null and ${t.url} is null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Runs

export const runs = sqliteTable(
  'runs',
  {
    id: id(),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'restrict' }),
    seriesId: integer('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'restrict' }),
    status: text('status', { enum: RUN_STATUSES }).notNull().default('queued'),
    currentStage: text('current_stage', { enum: STAGES }),
    /** Where the orchestrator is (P1C.9): the step the run is in or waits at. */
    pipelineStep: text('pipeline_step', { enum: PIPELINE_STEP_IDS }).notNull().default('ingest'),
    /** The job the current step queued (a job step), so the same job type twice stays apart. */
    stepJobId: integer('step_job_id').references((): AnySQLiteColumn => jobs.id, {
      onDelete: 'set null',
    }),
    /** Extra payload for the next job at a step (`StepRequestsSchema`), used once. */
    stepRequests: text('step_requests', { mode: 'json' })
      .$type<StepRequests>()
      .notNull()
      .default({}),
    /** The run's own overrides (as given when it started, then changed between jobs). */
    settings: text('settings', { mode: 'json' }).$type<RunSettings>().notNull(),
    /**
     * Every setting the run's jobs read, resolved once when it started (overrides, app settings,
     * defaults): `ResolvedRunSettingsSchema`.
     */
    resolvedSettings: text('resolved_settings', { mode: 'json' })
      .$type<ResolvedRunSettings>()
      .notNull(),
    /** A part of a multi-part video: the run that owns its research and plan (P1C.9). */
    parentRunId: integer('parent_run_id').references((): AnySQLiteColumn => runs.id, {
      onDelete: 'cascade',
    }),
    /** This part's number, from 1, and how many parts the video has; set iff `parent_run_id`. */
    partIndex: integer('part_index'),
    partCount: integer('part_count'),
    /**
     * A gate that waits for a review once, even with its auto-approve on (`resume --only`, P1C.9b):
     * cleared when a decision is made at it.
     */
    holdGate: text('hold_gate', { enum: GATE_IDS }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('runs_topic_idx').on(t.topicId),
    index('runs_status_idx').on(t.status),
    uniqueIndex('runs_parent_part_uq').on(t.parentRunId, t.partIndex),
    check(
      'runs_part_ck',
      sql`(${t.parentRunId} is null and ${t.partIndex} is null and ${t.partCount} is null) or (${t.parentRunId} is not null and ${t.partCount} >= 2 and ${t.partIndex} between 1 and ${t.partCount})`,
    ),
  ],
);

/** The exact source versions a run used. Rows outlive later re-fetches of the source. */
export const runSources = sqliteTable(
  'run_sources',
  {
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    contentHash: text('content_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.sourceId] })],
);

export const runSteps = sqliteTable(
  'run_steps',
  {
    id: id(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stage: text('stage', { enum: STAGES }).notNull(),
    /** The story beat a per-beat step is for (the Generator's); null for a whole-stage step. */
    beatId: text('beat_id'),
    status: text('status', { enum: STEP_STATUSES }).notNull().default('pending'),
    /** Who made the output: an agent, or the user's edit at a gate (P1C.9). */
    createdBy: text('created_by', { enum: SPEC_AUTHORS }).notNull().default('agent'),
    inputPath: text('input_path'),
    outputPath: text('output_path'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('run_steps_run_stage_idx').on(t.runId, t.stage)],
);

/** One row per gate per run, updated in place when the gate is decided again. */
export const gates = sqliteTable(
  'gates',
  {
    id: id(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    gate: text('gate', { enum: GATE_IDS }).notNull(),
    status: text('status', { enum: GATE_STATUSES }).notNull().default('pending'),
    /** What the scenes and draft gates review: the spec version they show and approve. */
    specVersionId: integer('spec_version_id').references(() => specVersions.id, {
      onDelete: 'set null',
    }),
    /** What the research and beat-sheet gates review: the step whose notes or plan they show. */
    subjectStepId: integer('subject_step_id').references(() => runSteps.id, {
      onDelete: 'set null',
    }),
    decidedBy: text('decided_by', { enum: DECIDED_BY }),
    /**
     * An approval kept for a new subject because a later gate's edit or regenerate reran this
     * gate's steps (the scenes gate after a beat regenerated at the draft gate): that gate.
     */
    carriedFrom: text('carried_from', { enum: GATE_IDS }),
    notes: text('notes'),
    decidedAt: timestamp('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('gates_run_gate_uq').on(t.runId, t.gate),
    check('gates_subject_ck', sql`${t.specVersionId} is null or ${t.subjectStepId} is null`),
  ],
);

export const specVersions = sqliteTable(
  'spec_versions',
  {
    id: id(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    jsonPath: text('json_path').notNull(),
    createdBy: text('created_by', { enum: SPEC_AUTHORS }).notNull(),
    /** Which external chat model produced an imported spec (e.g. `chatgpt`); set iff external. */
    sourceLabel: text('source_label'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('spec_versions_run_version_uq').on(t.runId, t.version),
    check(
      'spec_versions_source_ck',
      sql`(${t.createdBy} = 'external') = (${t.sourceLabel} is not null)`,
    ),
  ],
);

/** Every LLM call. `run_id` is null for calls outside a run (reference analyst, memory). */
export const llmCalls = sqliteTable(
  'llm_calls',
  {
    id: id(),
    runId: integer('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    stepId: integer('step_id').references(() => runSteps.id, { onDelete: 'set null' }),
    role: text('role', { enum: MODEL_ROLES }).notNull(),
    /** The role prompt's id and version, e.g. `director@v3`. */
    promptVersion: text('prompt_version').notNull(),
    /** The shared preamble's version, e.g. `preamble@v1`; null for a prompt without one. */
    preambleVersion: text('preamble_version'),
    /** 0 for the first call, then 1, 2… for repair retries of the same output. */
    attempt: integer('attempt').notNull().default(0),
    /** Fixes the normalizer applied to this response (`NormalizerFix[]`). */
    normalizerFixes: text('normalizer_fixes', { mode: 'json' })
      .$type<NormalizerFix[]>()
      .notNull()
      .default(sql`'[]'`),
    /** Model id requested (may be an alias). */
    model: text('model').notNull(),
    /** Model version reported by the API response. */
    servedModel: text('served_model'),
    tokensInCached: integer('tokens_in_cached').notNull().default(0),
    tokensInUncached: integer('tokens_in_uncached').notNull().default(0),
    /** Completion tokens, reasoning included (billed as output). */
    tokensOut: integer('tokens_out').notNull().default(0),
    /** The reasoning share of `tokens_out`, when the API reports it. */
    tokensReasoning: integer('tokens_reasoning').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    promptPath: text('prompt_path').notNull(),
    responsePath: text('response_path'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('llm_calls_run_idx').on(t.runId)],
);

// ---------------------------------------------------------------------------------------------
// Server <-> worker hand-off (see CLAUDE.md "Server and worker hand-off")

/**
 * Work queue. The server inserts jobs in the same transaction as the domain rows they act on; the
 * worker claims one at a time. `type` is free text matched against the worker's handler registry.
 * `payload` is small JSON; large inputs live in files.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: id(),
    type: text('type').notNull(),
    /** Null for jobs outside a run (asset seeding, reference analysis). */
    runId: integer('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lockedAt: timestamp('locked_at'),
    /** Worker instance that holds the lock (e.g. `<host>:<pid>`). */
    lockedBy: text('locked_by'),
    /** Not claimable before this time (retry backoff). */
    runAfter: timestamp('run_after')
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAfter), index('jobs_run_idx').on(t.runId)],
);

/**
 * Append-only progress log for runs and jobs. The worker writes; the server tails it by `id` for
 * SSE. `run_id` is null for jobs outside a run; every event has a run, a job or both. Payloads
 * are validated against `EventBodySchema` on write (`#core/db/repositories/events.ts`).
 */
export const events = sqliteTable(
  'events',
  {
    id: id(),
    runId: integer('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    jobId: integer('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    payload: text('payload', { mode: 'json' }).$type<EventBody['payload']>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('events_run_id_idx').on(t.runId, t.id),
    index('events_job_id_idx').on(t.jobId, t.id),
    check('events_owner_ck', sql`${t.runId} is not null or ${t.jobId} is not null`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Library, memory and backlog

/**
 * Text id: primitives and the LLM reference assets by id. The house SVG lives at `svg_path`
 * (`assets/<id>.svg`); only `approved` rows are in the library a render sees.
 */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    family: text('family', { enum: ASSET_FAMILIES }).notNull(),
    tags: jsonStringArray('tags'),
    styleVersion: integer('style_version').notNull().default(1),
    licence: text('licence').notNull(),
    source: text('source').notNull(),
    svgPath: text('svg_path').notNull(),
    status: text('status', { enum: ASSET_STATUSES }).notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assets_family_idx').on(t.family)],
);

/** The full extracted ReferenceVideo record lives at `record_path`; retrieval fields are columns. */
export const referenceVideos = sqliteTable('reference_videos', {
  id: id(),
  title: text('title').notNull(),
  topicClass: text('topic_class'),
  devices: jsonStringArray('devices'),
  breakdownPath: text('breakdown_path').notNull(),
  recordPath: text('record_path'),
  createdAt: createdAt(),
});

export const memoryRules = sqliteTable(
  'memory_rules',
  {
    id: id(),
    scope: text('scope', { enum: MEMORY_RULE_SCOPES }).notNull(),
    text: text('text').notNull(),
    status: text('status', { enum: MEMORY_RULE_STATUSES }).notNull().default('proposed'),
    /** The reviewer's gate note it was proposed from (P1C.10); null for a rule added by hand. */
    note: text('note'),
    /** The Analyst's one line: the preference in the note this rule generalises. */
    reason: text('reason'),
    sourceRunId: integer('source_run_id').references(() => runs.id, { onDelete: 'set null' }),
    sourceGate: text('source_gate', { enum: GATE_IDS }),
    /** The `gate` event of the decision it was proposed from. */
    sourceEventId: integer('source_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('memory_rules_status_scope_idx').on(t.status, t.scope)],
);

/** One row per (run, kind, value), recorded after export. Drives variety penalties. */
export const usageHistory = sqliteTable(
  'usage_history',
  {
    id: id(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: USAGE_KINDS }).notNull(),
    value: text('value').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_history_kind_created_idx').on(t.kind, t.createdAt),
    index('usage_history_run_idx').on(t.runId),
  ],
);

/** Requested by a run or by a reference video (or both). */
export const missingPrimitiveRequests = sqliteTable(
  'missing_primitive_requests',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    runId: integer('run_id').references(() => runs.id, { onDelete: 'set null' }),
    referenceVideoId: integer('reference_video_id').references(() => referenceVideos.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: BACKLOG_STATUSES }).notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('missing_primitive_requests_name_idx').on(t.name)],
);

/**
 * `restrict`: an exported run cannot be deleted, so the usage history that drives variety
 * penalties survives. Runs that never exported still cascade their usage rows on delete.
 */
export const exports = sqliteTable(
  'exports',
  {
    id: id(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'restrict' }),
    mp4Path: text('mp4_path').notNull(),
    srtPath: text('srt_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    durationMs: integer('duration_ms').notNull(),
    costUsd: real('cost_usd').notNull(),
    title: text('title'),
    description: text('description'),
    hashtags: jsonStringArray('hashtags'),
    createdAt: createdAt(),
  },
  (t) => [index('exports_run_idx').on(t.runId)],
);

/**
 * The one worker that may claim jobs (P1C.9b): crash recovery assumes a single worker, and the
 * CLI can run one in its own process. One row at most (`id` 1). The holder renews `heartbeat_at`;
 * a row whose heartbeat is stale, or whose process is gone on this host, may be taken over.
 */
export const workerLock = sqliteTable(
  'worker_lock',
  {
    id: integer('id').primaryKey(),
    /** `<host>:<pid>:<instance>`: one per worker started, even two in one process. */
    holder: text('holder').notNull(),
    host: text('host').notNull(),
    pid: integer('pid').notNull(),
    /** `cli` or `worker` (the `pnpm dev` / `start` process). */
    kind: text('kind', { enum: WORKER_KINDS }).notNull(),
    /** Where its LLM answers come from: a run started on a dry-run worker must not go live. */
    llmMode: text('llm_mode', { enum: LLM_MODES }).notNull(),
    acquiredAt: timestamp('acquired_at').notNull(),
    heartbeatAt: timestamp('heartbeat_at').notNull(),
  },
  (t) => [check('worker_lock_single_ck', sql`${t.id} = 1`)],
);
