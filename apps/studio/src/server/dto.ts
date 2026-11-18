import type { EventDto, RunDetailDto, RunDto, SeriesDto, TopicDto } from '@explainer-studio/shared';
import type { StoredEvent } from '#core/db/repositories/events.ts';
import type { Run } from '#core/db/repositories/runs.ts';
import type { Series } from '#core/db/repositories/series.ts';
import type { Topic } from '#core/db/repositories/topics.ts';
import type { RunDetail } from '#core/services/runs.ts';

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

export function toRunDetailDto(d: RunDetail): RunDetailDto {
  return { ...toRunDto(d.run), lastEventId: d.lastEventId };
}

export function toEventDto(e: StoredEvent): EventDto {
  const { createdAt, ...rest } = e;
  return { ...rest, createdAt: createdAt.toISOString() };
}
