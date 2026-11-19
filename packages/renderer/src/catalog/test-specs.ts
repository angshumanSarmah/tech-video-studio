import rateLimiterJson from '../../fixtures/rate-limiter.json';

type Json = Record<string, unknown>;
type EventJson = { action: string; targets: string[]; [key: string]: unknown };
type SpecJson = Json & { scenes: { elements?: Json[]; patterns?: Json[]; events?: EventJson[] }[] };

/**
 * A fresh copy of the rate-limiter fixture, which passes the registry checks (its payoff beat uses
 * the `flood_then_funnel` pattern). Tests mutate the copy.
 */
export function fixtureSpec(): SpecJson {
  const copy: unknown = structuredClone(rateLimiterJson);
  return copy as SpecJson;
}
