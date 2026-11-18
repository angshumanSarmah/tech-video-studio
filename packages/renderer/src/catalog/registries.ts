import { PATTERNS, type PatternRegistry } from '../patterns/registry.ts';
import { PRIMITIVES, type PrimitiveRegistry } from '../primitives/registry.ts';

/** The registries that validation, catalogues and the scene layer read. Injectable for tests. */
export type Registries = { primitives: PrimitiveRegistry; patterns: PatternRegistry };

export const DEFAULT_REGISTRIES: Registries = { primitives: PRIMITIVES, patterns: PATTERNS };
