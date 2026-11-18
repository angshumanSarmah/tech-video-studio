import type { RunDto, RunEventDto, SeriesDto, TopicDto } from '@explainer-studio/shared';
import type { RunEvent } from '#core/db/repositories/run-events.ts';
import type { Run } from '#core/db/repositories/runs.ts';
import type { Series } from '#core/db/repositories/series.ts';
import type { Topic } from '#core/db/repositories/topics.ts';

/** DB rows -> wire shapes (`Date` -> ISO string, internal columns dropped). */

export function toSeriesDto(s: Series): SeriesDto {
  return { id: s.id, name: s.name, tag: s.tag, label: s.label, accentColour: s.accentColour };
}

export function toTopicDto(t: Topic): TopicDto {
  return { id: t.id, title: t.title, notes: t.notes, createdAt: t.createdAt.toISOString() };
}

export function toRunDto(r: Run): RunDto {
  return {
    id: r.id,
    topicId: r.topicId,
    seriesId: r.seriesId,
    status: r.status,
    currentStage: r.currentStage,
    settings: r.settings,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRunEventDto(e: RunEvent): RunEventDto {
  return {
    id: e.id,
    runId: e.runId,
    jobId: e.jobId,
    type: e.type,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  };
}
