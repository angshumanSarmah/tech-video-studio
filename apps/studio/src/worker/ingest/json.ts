import { SourceIngestError } from './errors.ts';
import type { ExtractedDocument } from './html.ts';
import { labelledRows } from './tables.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/**
 * A JSON file as readable text: a list of records becomes labelled rows (`labelledRows`, nested
 * fields as `parent.child`) under a heading with its path; an object's plain values become
 * `key: value` lines, its nested objects and lists sections of their own. The title is left to
 * the file name.
 */
export function extractJson(source: string): ExtractedDocument {
  let value: Json;
  try {
    value = JSON.parse(source) as Json;
  } catch (error) {
    throw new SourceIngestError(
      'unreadable',
      `The JSON does not parse (${(error as Error).message}). Fix the file, or paste its content as text.`,
      { cause: error },
    );
  }
  return { title: null, text: blocks(value, '').join('\n\n') };
}

function blocks(value: Json, path: string): string[] {
  if (isRecordList(value)) return [...heading(path), recordTable(value)];
  if (Array.isArray(value)) {
    const scalars = value.filter((v) => !isNested(v));
    const lines =
      scalars.length > 0 ? [`${path || 'values'}: ${scalars.map(scalar).join(', ')}`] : [];
    return [...lines, ...value.filter(isNested).flatMap((v, i) => blocks(v, `${path}[${i}]`))];
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    const plain = entries.filter(([, v]) => !isNested(v)).map(([k, v]) => `${k}: ${scalar(v)}`);
    const nested = entries
      .filter(([, v]) => isNested(v))
      .flatMap(([k, v]) => blocks(v, path ? `${path}.${k}` : k));
    return [...(plain.length > 0 ? [...heading(path), plain.join('\n')] : []), ...nested];
  }
  return [scalar(value)];
}

const heading = (path: string): string[] => (path ? [`# ${path}`] : []);

function recordTable(records: readonly JsonObject[]): string {
  const rows = records.map((r) => flatten(r, ''));
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return labelledRows(
    columns,
    rows.map((r) => columns.map((c) => r[c] ?? '')),
  );
}

/** A record's fields as `{ 'a.b': text }`: nested objects flattened, lists of values joined. */
function flatten(record: JsonObject, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) Object.assign(out, flatten(value, name));
    else if (Array.isArray(value) && !value.some(isNested))
      out[name] = value.map(scalar).join(', ');
    else if (Array.isArray(value)) out[name] = JSON.stringify(value);
    else out[name] = scalar(value);
  }
  return out;
}

function isRecordList(value: Json): value is JsonObject[] {
  return Array.isArray(value) && value.length > 0 && value.every(isObject);
}

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNested = (value: Json): boolean => typeof value === 'object' && value !== null;

function scalar(value: Json): string {
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
