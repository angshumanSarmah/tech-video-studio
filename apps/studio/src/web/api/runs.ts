import {
  RunDetailDtoSchema,
  RunListResponseSchema,
  type RunDetailDto,
  type RunDto,
} from '@explainer-studio/shared';
import { request } from './client.ts';

export async function listRuns(): Promise<RunDto[]> {
  return (await request('/runs', RunListResponseSchema)).items;
}

/** Snapshot of one run; `lastEventId` is the SSE cursor that continues from it. */
export function getRun(id: number): Promise<RunDetailDto> {
  return request(`/runs/${id}`, RunDetailDtoSchema);
}
