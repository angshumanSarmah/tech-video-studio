import rateLimiterJson from '../../fixtures/rate-limiter.json';

type Json = Record<string, unknown>;
type EventJson = { action: string; targets: string[]; [key: string]: unknown };
type SpecJson = Json & { scenes: { elements?: Json[]; patterns?: Json[]; events?: EventJson[] }[] };

/** The rate-limiter fixture as written: uses `node_card`, a pattern and `lock` on a tag. */
export function fixtureSpec(): SpecJson {
  const copy: unknown = structuredClone(rateLimiterJson);
  return copy as SpecJson;
}

/**
 * The fixture rewritten to pass the registry checks with only `tag` and `counter`: node cards
 * become tags, the pattern is dropped, and `lock` becomes `pulse`. Tests mutate the fresh copy.
 */
export function registryValidSpec() {
  const spec = fixtureSpec();
  for (const scene of spec.scenes) {
    scene.elements = (scene.elements ?? []).map((e) =>
      e.primitive === 'node_card'
        ? { ...e, primitive: 'tag', props: { text: (e.props as { title: string }).title } }
        : e,
    );
    const patternIds = new Set((scene.patterns ?? []).map((p) => p.id));
    scene.patterns = [];
    scene.events = (scene.events ?? [])
      .map((e) => ({ ...e, targets: e.targets.filter((t) => !patternIds.has(t)) }))
      .map((e) => (e.action === 'lock' ? { ...e, action: 'pulse' } : e));
  }
  return spec;
}
