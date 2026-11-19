// React-free registry API: safe to import from the worker (validation, prompts) and the server.
export * from '../primitives/types.ts';
export * from '../primitives/registry.ts';
export * from '../patterns/types.ts';
export * from '../patterns/registry.ts';
export * from '../layout/modes.ts';
export { formatAreas, type FormatAreas } from '../layout/format.ts';
export { specLayout, specLayoutWarnings, type SpecLayout } from '../layout/spec-layout.ts';
export type { BoardLayout, LayoutWarning, PlacedItem } from '../layout/types.ts';
export * from '../assets/house-svg.ts';
export * from '../assets/library.ts';
export * from '../assets/seed.ts';
export * from './asset-uses.ts';
export * from './registries.ts';
export * from './validate.ts';
export * from './catalogue.ts';
