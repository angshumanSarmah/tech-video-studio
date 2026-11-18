import { describe, expect, it } from 'vitest';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { PRIMITIVES } from '../primitives/registry.ts';
import { buildCatalogue, catalogueJson, catalogueMarkdown } from './catalogue.ts';
import type { Registries } from './registries.ts';

const withPatterns: Registries = {
  primitives: PRIMITIVES,
  patterns: buildPatternRegistry([bouncePattern]),
};

describe('buildCatalogue', () => {
  it('lists every registered primitive, ordered by family, with LLM-facing fields only', () => {
    const { primitives, patterns } = buildCatalogue();
    expect(primitives.map((p) => p.id)).toEqual(['tag', 'counter']);
    expect(patterns).toEqual([]);
    const tag = primitives[0];
    expect(Object.keys(tag ?? {})).toEqual([
      'id',
      'family',
      'summary',
      'whenToUse',
      'whenNotToUse',
      'actions',
      'props',
      'example',
    ]);
    expect(tag?.props).toMatchObject({
      type: 'object',
      required: ['text'],
      additionalProperties: false,
    });
    expect(tag?.props).not.toHaveProperty('$schema');
    expect(tag?.example).toEqual({
      id: '<example-tag-id>',
      primitive: 'tag',
      props: { text: '<example-label>', semantic: 'problem' },
    });
  });

  it('includes patterns with their narration anchors', () => {
    const [bounce] = buildCatalogue(withPatterns).patterns;
    expect(bounce).toMatchObject({
      id: 'test_bounce',
      anchors: [{ name: 'bounce', description: bouncePattern.anchors[0]?.description }],
      example: { id: '<example-test_bounce-id>', pattern: 'test_bounce' },
    });
  });
});

describe('catalogue files', () => {
  it('JSON round-trips to the catalogue and never carries size hints', () => {
    const json = catalogueJson();
    expect(JSON.parse(json)).toEqual(buildCatalogue());
    expect(json).not.toMatch(/preferredWidth|minWidth/);
  });

  it('markdown documents each primitive, its props and example, and says when no patterns exist', () => {
    const md = catalogueMarkdown();
    expect(md).toContain('### tag');
    expect(md).toContain('### counter');
    expect(md).toContain('| `text` | string | yes |');
    expect(md).toContain('"primitive": "counter"');
    expect(md).toMatch(/\*\*Size hint\*\* \(example, blueprint-dark\): \d+ × \d+ px/);
    expect(md).toContain('No patterns are registered yet.');
  });

  it('markdown documents registered patterns', () => {
    const md = catalogueMarkdown(withPatterns);
    expect(md).toContain('### test_bounce');
    expect(md).toContain('- `bounce`: ');
  });
});
