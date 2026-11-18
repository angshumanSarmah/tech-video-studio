import { HealthResponseSchema, type HealthResponse } from '@explainer-studio/shared';

export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthResponse> {
  const res = await fetchFn('/api/health');
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return HealthResponseSchema.parse(await res.json());
}
