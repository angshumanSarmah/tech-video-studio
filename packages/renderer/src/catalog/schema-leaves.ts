import type { z } from 'zod';
import type { AnyPatternDefinition } from '../patterns/types.ts';
import type { AnyPrimitiveDefinition } from '../primitives/types.ts';
import type { DisplayUnit } from '../primitives/common-props.ts';
import { inputJsonSchema } from './catalogue.ts';

/**
 * The leaves of a primitive's props or a pattern's params that the screen checks read, found by
 * walking the value against its JSON Schema (input side) and the metadata on it
 * (`common-props.ts`): asset ids (`assetId`), numbers drawn on screen (`displayNumber`) and plain
 * screen text (one-line or free strings: no enum, no id or anchor pattern, not `screenText:
 * false`). Generic over the registries: a new primitive needs no edit here. Pure.
 */

type Path = (string | number)[];
type JsonSchema = Record<string, unknown>;

export type Leaf =
  | { kind: 'asset'; path: Path; value: string }
  | { kind: 'text'; path: Path; value: string }
  | {
      kind: 'number';
      path: Path;
      value: number;
      unit?: DisplayUnit;
      /** A counter's number may step a research value by up to this much (`steppingNumber`). */
      steps?: number;
    };

/** The one-line text pattern of `lineText`, as JSON Schema writes it. */
const ONE_LINE_PATTERN = '^[^\\n\\r]*$';

const schemas = new WeakMap<z.ZodType, JsonSchema>();

function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  const cached = schemas.get(schema);
  if (cached) return cached;
  const json = inputJsonSchema(schema);
  schemas.set(schema, json);
  return json;
}

export function propLeaves(definition: AnyPrimitiveDefinition, props: unknown): Leaf[] {
  return schemaLeaves(jsonSchemaOf(definition.propsSchema), props);
}

/** Leaves of a pattern's params, without its anchors (`params.at`). */
export function paramLeaves(definition: AnyPatternDefinition, params: unknown): Leaf[] {
  return schemaLeaves(jsonSchemaOf(definition.paramsSchema), params).filter(
    (leaf) => leaf.path[0] !== 'at',
  );
}

export function schemaLeaves(node: unknown, value: unknown, path: Path = []): Leaf[] {
  if (!isRecord(node)) return [];
  const options = [node.anyOf, node.oneOf].find(Array.isArray) as unknown[] | undefined;
  if (options) {
    const option = options.find((o) => fits(o, value));
    return option ? schemaLeaves(option, value, path) : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => schemaLeaves(node.items, item, [...path, i]));
  }
  if (isRecord(value)) {
    const properties = isRecord(node.properties) ? node.properties : {};
    return Object.entries(value).flatMap(([key, child]) =>
      schemaLeaves(properties[key], child, [...path, key]),
    );
  }
  return leaf(node, value, path);
}

function leaf(node: JsonSchema, value: unknown, path: Path): Leaf[] {
  if (typeof value === 'string') {
    if (node.assetId === true) return [{ kind: 'asset', path, value }];
    return isScreenText(node) ? [{ kind: 'text', path, value }] : [];
  }
  if (typeof value === 'number' && isRecord(node.displayNumber)) {
    const unit = node.displayNumber.unit as DisplayUnit | undefined;
    const steps = node.displayNumber.steps;
    return [
      {
        kind: 'number',
        path,
        value,
        ...(unit ? { unit } : {}),
        ...(typeof steps === 'number' ? { steps } : {}),
      },
    ];
  }
  return [];
}

function isScreenText(node: JsonSchema): boolean {
  if (node.screenText === false || node.enum !== undefined || node.const !== undefined) {
    return false;
  }
  if (node.screenText === true) return true;
  return node.pattern === undefined || node.pattern === ONE_LINE_PATTERN;
}

/** Whether a union option's type matches the value's (the first match is walked). */
function fits(option: unknown, value: unknown): boolean {
  if (!isRecord(option)) return false;
  const types = Array.isArray(option.type) ? option.type : [option.type];
  const kind = Array.isArray(value)
    ? 'array'
    : value === null
      ? 'null'
      : typeof value === 'object'
        ? 'object'
        : typeof value;
  if (kind === 'number' && types.includes('integer')) return Number.isInteger(value);
  return types.includes(kind) || (option.type === undefined && option.const === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
