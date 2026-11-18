import rateLimiterJson from '../../fixtures/rate-limiter.json';

type Json = Record<string, unknown>;
type EventJson = { action: string; targets: string[]; [key: string]: unknown };
type SpecJson = Json & { scenes: { elements?: Json[]; patterns?: Json[]; events?: EventJson[] }[] };

/** The rate-limiter fixture as written: uses the `flood_then_funnel` pattern (P1A.8). */
export function fixtureSpec(): SpecJson {
  const copy: unknown = structuredClone(rateLimiterJson);
  return copy as SpecJson;
}

/**
 * The fixture without its pattern (not registered until P1A.8), so it passes the registry
 * checks. Tests mutate the fresh copy.
 */
export function registryValidSpec() {
  const spec = fixtureSpec();
  for (const scene of spec.scenes) {
    const patternIds = new Set((scene.patterns ?? []).map((p) => p.id));
    scene.patterns = [];
    scene.events = (scene.events ?? []).map((e) => ({
      ...e,
      targets: e.targets.filter((t) => !patternIds.has(t)),
    }));
  }
  return spec;
}
