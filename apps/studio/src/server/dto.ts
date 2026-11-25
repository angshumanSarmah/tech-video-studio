import type {
  BacklogRequestDto,
  EventDto,
  GateDto,
  JobDto,
  MemoryRuleDto,
  ReferenceDetailDto,
  ReferenceSummaryDto,
  RunDetailDto,
  RunDto,
  SeriesDto,
  SourceDto,
  TopicDto,
} from '@explainer-studio/shared';
import { posix } from 'node:path';
import type { StoredEvent } from '#core/db/repositories/events.ts';
import type { Job } from '#core/db/repositories/jobs.ts';
import type { RunSummary } from '#core/db/repositories/runs.ts';
import type { Series } from '#core/db/repositories/series.ts';
import type { Source } from '#core/db/repositories/sources.ts';
import type { Topic } from '#core/db/repositories/topics.ts';
import type { GateView } from '#core/services/gates.ts';
import type { MemoryRule } from '#core/services/style-rules.ts';
import type { BacklogRequest } from '#core/db/repositories/backlog.ts';
import type { ReferenceRow } from '#core/db/repositories/references.ts';
import type { ReferenceDetail } from '#core/services/references.ts';
import type { RunDetail } from '#core/services/runs.ts';

/** DB rows -> wire shapes (`Date` -> ISO string, internal columns dropped). */

export function toSeriesDto(s: Series): SeriesDto {
  return { id: s.id, name: s.name, tag: s.tag, label: s.label, accentColour: s.accentColour };
}

export function toTopicDto(t: Topic): TopicDto {
  return { id: t.id, title: t.title, notes: t.notes, createdAt: t.createdAt.toISOString() };
}

export function toRunDto(r: RunSummary): RunDto {
  return {
    id: r.id,
    topicId: r.topicId,
    seriesId: r.seriesId,
    status: r.status,
    currentStage: r.currentStage,
    settings: r.settings,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRunDetailDto(d: RunDetail): RunDetailDto {
  return { ...toRunDto(d.run), lastEventId: d.lastEventId };
}

export function toEventDto(e: StoredEvent): EventDto {
  const { createdAt, ...rest } = e;
  return { ...rest, createdAt: createdAt.toISOString() };
}

export function toJobDto(j: Job): JobDto {
  return {
    id: j.id,
    type: j.type,
    runId: j.runId,
    status: j.status,
    createdAt: j.createdAt.toISOString(),
  };
}

export function toGateDto(g: GateView): GateDto {
  return { ...g, decidedAt: g.decidedAt?.toISOString() ?? null };
}

export function toSourceDto(s: Source): SourceDto {
  return {
    id: s.id,
    topicId: s.topicId,
    kind: s.kind,
    url: s.url,
    fileName: s.kind === 'file' && s.filePath ? posix.basename(s.filePath) : null,
    title: s.title,
    status: s.status,
    error: s.error,
    errorCode: s.errorCode,
    extractedAt: s.extractedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export function toMemoryRuleDto(r: MemoryRule): MemoryRuleDto {
  return {
    id: r.id,
    scope: r.scope,
    text: r.text,
    status: r.status,
    note: r.note,
    reason: r.reason,
    sourceRunId: r.sourceRunId,
    sourceGate: r.sourceGate,
    sourceEventId: r.sourceEventId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toReferenceSummaryDto(r: ReferenceRow): ReferenceSummaryDto {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    origin: r.origin,
    status: r.status,
    topicClass: r.topicClass,
    devices: r.devices as ReferenceSummaryDto['devices'],
    error: r.error,
    attachments: r.attachments.length,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toBacklogRequestDto(r: BacklogRequest): BacklogRequestDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    runId: r.runId,
    referenceVideoId: r.referenceVideoId,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toReferenceDetailDto(d: ReferenceDetail): ReferenceDetailDto {
  return {
    ...toReferenceSummaryDto(d.row),
    breakdown: d.breakdown,
    record: d.record,
    attachmentFiles: d.row.attachments,
    backlog: d.backlog.map(toBacklogRequestDto),
  };
}
