import { SEED_REGISTRY, type AssetRegistry } from '../assets/library.ts';
import { PATTERNS, type PatternRegistry } from '../patterns/registry.ts';
import { PRIMITIVES, type PrimitiveRegistry } from '../primitives/registry.ts';

/** The registries that validation, catalogues and the scene layer read. Injectable for tests. */
export type Registries = {
  primitives: PrimitiveRegistry;
  patterns: PatternRegistry;
  assets: AssetRegistry;
};

export const DEFAULT_REGISTRIES: Registries = {
  primitives: PRIMITIVES,
  patterns: PATTERNS,
  /** The seed library; the worker injects the DB library (P1C.4). */
  assets: SEED_REGISTRY,
};
