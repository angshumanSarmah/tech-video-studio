import { HealthResponseSchema, type HealthResponse } from '@explainer-studio/shared';
import { request } from './client.ts';

export function fetchHealth(): Promise<HealthResponse> {
  return request('/health', HealthResponseSchema);
}
