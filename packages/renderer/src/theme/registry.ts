import { ThemeSchema, type Theme, type ThemeInput } from './schema.ts';
import { safeAreas } from './safe-area.ts';
import { blueprintDark } from './themes/blueprint-dark.ts';
import { draftingPaper } from './themes/drafting-paper.ts';

/** Every theme the renderer knows. Add a theme by adding its module here. */
const THEME_MODULES: readonly ThemeInput[] = [blueprintDark, draftingPaper];

/**
 * Default video theme. `blueprint-dark` stays registered (selectable via `themeId`) but is parked:
 * new primitives are reviewed visually only in the default; `still:compare` checks the others.
 */
export const DEFAULT_THEME_ID = 'drafting-paper';

/** Validates each theme and indexes it by id; throws on an invalid theme or a duplicate id. */
export function buildThemeRegistry(inputs: readonly ThemeInput[]): ReadonlyMap<string, Theme> {
  const registry = new Map<string, Theme>();
  for (const input of inputs) {
    const theme = ThemeSchema.parse(input);
    safeAreas(theme); // throws when the safe-area settings leave no room for a band or the stage
    if (registry.has(theme.id)) throw new Error(`Duplicate theme id "${theme.id}"`);
    registry.set(theme.id, theme);
  }
  return registry;
}

const REGISTRY = buildThemeRegistry(THEME_MODULES);

export function listThemes(): Theme[] {
  return [...REGISTRY.values()];
}

export function isThemeId(id: string): boolean {
  return REGISTRY.has(id);
}

export function getTheme(id: string = DEFAULT_THEME_ID): Theme {
  const theme = REGISTRY.get(id);
  if (!theme) {
    throw new Error(`Unknown theme "${id}". Known themes: ${[...REGISTRY.keys()].join(', ')}`);
  }
  return theme;
}
