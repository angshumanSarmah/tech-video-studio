import type { AssetRegistry } from './library.ts';

/**
 * The approved asset an unknown id almost names (P1C.7): the same id up to letter case, `_`
 * against `-`, a plural `s` / `es`, or a declared alias (aliases arrive with P1C.12). Only such
 * near-identical names are substituted automatically (and logged); anything else stays unknown
 * and goes to the run's missing-assets list. Undefined for a known id or no near match. Pure.
 */
export function nearIdenticalAsset(
  id: string,
  registry: AssetRegistry,
  aliases: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  if (registry.has(id)) return undefined;
  const alias = aliases.get(id);
  if (alias !== undefined && registry.has(alias)) return alias;
  return nameForms(id).find((form) => form !== id && registry.has(form));
}

/** The forms tried, in a fixed order (first hit wins). */
export function nameForms(id: string): string[] {
  const lower = id.toLowerCase();
  const separators = [lower, lower.replaceAll('-', '_'), lower.replaceAll('_', '-')];
  const forms = separators.flatMap((base) => [base, ...numberForms(base)]);
  return [...new Set(forms)];
}

/** Singular and plural of the last word: `servers` → `server`, `boxes` → `box`, `key` → `keys`. */
function numberForms(base: string): string[] {
  const forms: string[] = [];
  if (base.endsWith('es')) forms.push(base.slice(0, -2));
  if (base.endsWith('s')) forms.push(base.slice(0, -1));
  forms.push(`${base}s`, `${base}es`);
  return forms;
}
