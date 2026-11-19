import { EVENT_ACTIONS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { inputJsonSchema } from '../catalog/catalogue.ts';
import { getTheme } from '../theme/index.ts';
import { componentFor } from './components.ts';
import { buildPrimitiveRegistry, getPrimitive, listPrimitives } from './registry.ts';
import { tagPrimitive } from './tag/definition.ts';
import { PRIMITIVE_FAMILIES, withEndings } from './types.ts';

const theme = getTheme();
const ids = new Set(listPrimitives().map((p) => p.id));

describe.each(listPrimitives().map((p) => [p.id, p] as const))('primitive %s', (_id, primitive) => {
  it('has a family, known actions and a component', () => {
    expect(PRIMITIVE_FAMILIES).toContain(primitive.family);
    expect(primitive.actions.length).toBeGreaterThan(0);
    for (const action of primitive.actions) expect(EVENT_ACTIONS).toContain(action);
    expect(componentFor(primitive.id)).toBeDefined();
  });

  it('describes itself for the LLM', () => {
    const { summary, whenToUse, whenNotToUse } = primitive.description;
    for (const text of [summary, whenToUse, whenNotToUse]) expect(text.length).toBeGreaterThan(20);
  });

  it('only names registered primitives, its own (part) actions or its own props in backticks', () => {
    const props = Object.keys(inputJsonSchema(primitive.propsSchema).properties as object);
    const partActions = primitive.parts?.actions ?? [];
    const allowed = new Set([...ids, ...primitive.actions, ...partActions, ...props]);
    const text = Object.values(primitive.description).join(' ');
    for (const [, name] of text.matchAll(/`([^`]+)`/g)) expect(allowed, name).toContain(name);
  });

  it('gives positive size hints for its example, with min <= preferred', () => {
    const hints = primitive.sizeHints(primitive.propsSchema.parse(primitive.example.props), theme);
    expect(hints.minWidth).toBeGreaterThan(0);
    expect(hints.minHeight).toBeGreaterThan(0);
    expect(hints.preferredWidth).toBeGreaterThanOrEqual(hints.minWidth);
    expect(hints.preferredHeight).toBeGreaterThanOrEqual(hints.minHeight);
  });

  it('supports recover exactly where it supports reject, on the element and its parts', () => {
    expect(primitive.actions.includes('recover')).toBe(primitive.actions.includes('reject'));
    const parts = primitive.parts?.actions ?? [];
    expect(parts.includes('recover')).toBe(parts.includes('reject'));
  });

  it('lists the parts of its example, without duplicates', () => {
    if (!primitive.parts) return;
    const partIds = primitive.parts.ids(primitive.propsSchema.parse(primitive.example.props));
    expect(new Set(partIds).size).toBe(partIds.length);
    for (const action of primitive.parts.actions) expect(EVENT_ACTIONS).toContain(action);
  });

  it('rejects unknown props', () => {
    const props = { ...(primitive.example.props as object), notAProp: 1 };
    expect(primitive.propsSchema.safeParse(props).success).toBe(false);
  });
});

describe('primitive registry', () => {
  it('looks primitives up by id', () => {
    expect(getPrimitive('tag')).toBe(tagPrimitive);
    expect(getPrimitive('node_box')).toBeUndefined();
    expect(componentFor('node_box')).toBeUndefined();
    expect(componentFor('toString')).toBeUndefined();
  });

  it('rejects duplicate ids, non-slug ids and examples that fail their schema', () => {
    expect(() => buildPrimitiveRegistry([tagPrimitive, tagPrimitive])).toThrow(/Duplicate/);
    expect(() => buildPrimitiveRegistry([{ ...tagPrimitive, id: 'Tag Box' }])).toThrow(/Invalid/);
    const badExample = { ...tagPrimitive, example: { props: { text: '' } } };
    expect(() => buildPrimitiveRegistry([badExample])).toThrow(/Example props of primitive "tag"/);
  });
});

describe('withEndings', () => {
  it('adds recover right after reject, once, and nowhere else', () => {
    expect(withEndings(['enter', 'reject', 'dim'])).toEqual(['enter', 'reject', 'recover', 'dim']);
    expect(withEndings(['enter', 'dim'])).toEqual(['enter', 'dim']);
    expect(withEndings(['reject', 'recover'])).toEqual(['reject', 'recover']);
  });

  it('adds release right after lock, once', () => {
    expect(withEndings(['lock', 'reject'])).toEqual(['lock', 'release', 'reject', 'recover']);
    expect(withEndings(['lock', 'release'])).toEqual(['lock', 'release']);
  });
});

describe('tag size hints', () => {
  it('grow with the text', () => {
    const short = tagPrimitive.sizeHints({ text: '429', semantic: 'neutral' }, theme);
    const long = tagPrimitive.sizeHints({ text: 'rate limited', semantic: 'neutral' }, theme);
    expect(long.preferredWidth).toBeGreaterThan(short.preferredWidth);
    expect(long.preferredHeight).toBe(short.preferredHeight);
  });
});
