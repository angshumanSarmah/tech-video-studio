import { aliasIndex } from './aliases.ts';
import type { AssetRegistry } from './library.ts';

/**
 * The approved asset an unknown id almost names (P1C.7): the same id up to letter case, `_`
 * against `-`, a plural `s` / `es`, or an alias an approved asset declares (P1C.12; the same
 * forms apply to aliases, so `gpu_cards` finds `gpu` through `gpu_card`). Only such
 * near-identical names are substituted automatically (and logged); anything else stays unknown
 * and goes to the run's missing-assets list. Undefined for a known id or no near match. Pure.
 */
export function nearIdenticalAsset(id: string, registry: AssetRegistry): string | undefined {
  if (registry.has(id)) return undefined;
  const aliases = aliasIndex(registry);
  // An exact alias is the most specific match, then the id's other forms, then their aliases.
  const exact = aliases.get(id);
  if (exact !== undefined && registry.has(exact)) return exact;
  const forms = nameForms(id);
  const asId = forms.find((form) => form !== id && registry.has(form));
  if (asId !== undefined) return asId;
  for (const form of forms) {
    const target = aliases.get(form);
    if (target !== undefined && registry.has(target)) return target;
  }
  return undefined;
}

/** The forms tried, in a fixed order (first hit wins); the id itself comes first. */
export function nameForms(id: string): string[] {
  const lower = id.toLowerCase();
  const separators = [lower, lower.replaceAll('-', '_'), lower.replaceAll('_', '-')];
  const forms = separators.flatMap((base) => [base, ...numberForms(base)]);
  return [...new Set([id, ...forms])];
}

/** Singular and plural of the last word: `servers` → `server`, `boxes` → `box`, `key` → `keys`. */
function numberForms(base: string): string[] {
  const forms: string[] = [];
  if (base.endsWith('es')) forms.push(base.slice(0, -2));
  if (base.endsWith('s')) forms.push(base.slice(0, -1));
  forms.push(`${base}s`, `${base}es`);
  return forms;
}
