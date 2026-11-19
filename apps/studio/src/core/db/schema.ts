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
  RUN_STATUSES,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  SPEC_AUTHORS,
  STAGES,
  STEP_STATUSES,
  USAGE_KINDS,
  type EventBody,
  type RunSettings,
} from '@explainer-studio/shared';
import { sql } from 'drizzle-orm';
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
    /** Uploaded original, relative to the data dir. */
    filePath: text('file_path'),
    status: text('status', { enum: SOURCE_STATUSES }).notNull().default('pending'),
    /** Latest extracted text, relative to the data dir. */
    textPath: text('text_path'),
    /** sha256 (hex) of the latest extracted text. */
    contentHash: text('content_hash'),
    error: text('error'),
    extractedAt: timestamp('extracted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sources_topic_idx').on(t.topicId),
    check(
      'sources_kind_ck',
      sql`(${t.kind} = 'url' and ${t.url} is not null and ${t.filePath} is null) or (${t.kind} = 'file' and ${t.filePath} is not null and ${t.url} is null)`,
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
    settings: text('settings', { mode: 'json' }).$type<RunSettings>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('runs_topic_idx').on(t.topicId), index('runs_status_idx').on(t.status)],
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
    status: text('status', { enum: STEP_STATUSES }).notNull().default('pending'),
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
    decidedBy: text('decided_by', { enum: DECIDED_BY }),
    notes: text('notes'),
    decidedAt: timestamp('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('gates_run_gate_uq').on(t.runId, t.gate)],
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
    /** Prompt template id and version, e.g. `director@v3`. */
    promptVersion: text('prompt_version').notNull(),
    /** Model id requested (may be an alias). */
    model: text('model').notNull(),
    /** Model version reported by the API response. */
    servedModel: text('served_model'),
    tokensInCached: integer('tokens_in_cached').notNull().default(0),
    tokensInUncached: integer('tokens_in_uncached').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
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
    sourceRunId: integer('source_run_id').references(() => runs.id, { onDelete: 'set null' }),
    sourceGate: text('source_gate', { enum: GATE_IDS }),
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
