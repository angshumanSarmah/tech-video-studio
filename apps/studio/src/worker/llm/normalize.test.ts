import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, normalizeJsonText, parseAliasPath, type FieldAlias } from './normalize.ts';

describe('extractJson', () => {
  it('leaves clean JSON alone, with no fixes', () => {
    expect(extractJson(' {"a":1}\n')).toEqual({ ok: true, value: { a: 1 }, fixes: [] });
  });

  it('strips a code fence', () => {
    const result = extractJson('```json\n{"a": 1}\n```');
    expect(result).toMatchObject({ ok: true, value: { a: 1 } });
    expect(result.fixes.map((f) => f.kind)).toEqual(['strip_fences']);
  });

  it('strips a fence and the prose around it', () => {
    const result = extractJson('Here is the plan:\n```\n{"a": [1, 2]}\n```\nHope this helps.');
    expect(result).toMatchObject({ ok: true, value: { a: [1, 2] } });
    expect(result.fixes.map((f) => f.kind)).toEqual(['strip_fences', 'strip_prose']);
  });

  it('strips prose around a bare object, ignoring brackets inside strings', () => {
    const result = extractJson('Sure! {"label": "a } b { c", "n": {"m": "\\"}"}} Done.');
    expect(result).toMatchObject({ ok: true, value: { label: 'a } b { c', n: { m: '"}' } } });
    expect(result.fixes.map((f) => f.kind)).toEqual(['strip_prose']);
  });

  it('fails without a JSON object, and on broken JSON', () => {
    expect(extractJson('I cannot help with that.')).toMatchObject({ ok: false });
    expect(extractJson('{"a": 1,}')).toMatchObject({ ok: false });
    expect(extractJson('{"a": ')).toMatchObject({ ok: false });
  });
});

describe('aliases', () => {
  const aliases: FieldAlias[] = [
    { at: '$.script[*]', from: 'title', to: 'headline' },
    { at: '$.scenes[*].elements[*]', from: 'visual_type', to: 'kind' },
  ];

  it('renames only inside the declared objects, keeping key order', () => {
    const text = JSON.stringify({
      meta: { title: 'Kept as is' },
      script: [{ beatId: 'a', title: 'X = Y', narration: 'n' }],
      scenes: [{ elements: [{ id: 'e', visual_type: 'node_card' }] }],
    });
    const result = normalizeJsonText(text, { aliases });
    expect(result).toMatchObject({
      ok: true,
      value: {
        meta: { title: 'Kept as is' },
        script: [{ beatId: 'a', headline: 'X = Y', narration: 'n' }],
        scenes: [{ elements: [{ id: 'e', kind: 'node_card' }] }],
      },
    });
    if (!result.ok) throw new Error('expected ok');
    expect(Object.keys((result.value as { script: object[] }).script[0]!)).toEqual([
      'beatId',
      'headline',
      'narration',
    ]);
    expect(result.fixes).toEqual([
      { kind: 'alias', path: '$.script[0].headline', message: 'Renamed "title" to "headline"' },
      {
        kind: 'alias',
        path: '$.scenes[0].elements[0].kind',
        message: 'Renamed "visual_type" to "kind"',
      },
    ]);
  });

  it('never overwrites a field that is already there', () => {
    const result = normalizeJsonText('{"script":[{"title":"a","headline":"b"}]}', { aliases });
    expect(result).toMatchObject({
      ok: true,
      value: { script: [{ title: 'a', headline: 'b' }] },
      fixes: [],
    });
  });

  it('rejects malformed alias paths', () => {
    expect(() => parseAliasPath('script[*]')).toThrow(/start with/);
    expect(() => parseAliasPath('$.script[0]')).toThrow(/Invalid alias path/);
    expect(parseAliasPath('$.a[*].b')).toEqual([
      { kind: 'key', key: 'a' },
      { kind: 'each' },
      { kind: 'key', key: 'b' },
    ]);
  });
});

describe('numeric strings', () => {
  const schema = z.strictObject({
    targetSec: z.number().int(),
    label: z.string(),
    beats: z.array(z.strictObject({ sec: z.number(), id: z.string() })),
    either: z.union([z.number(), z.boolean()]).optional(),
  });

  it('converts only where the schema expects a number', () => {
    const text = JSON.stringify({
      targetSec: '60',
      label: '404',
      beats: [{ sec: '7.5', id: '2' }],
    });
    const result = normalizeJsonText(text, { schema });
    expect(result).toMatchObject({
      ok: true,
      value: { targetSec: 60, label: '404', beats: [{ sec: 7.5, id: '2' }] },
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.fixes).toEqual([
      { kind: 'numeric_string', path: '$.targetSec', message: 'Converted "60" to a number' },
      { kind: 'numeric_string', path: '$.beats[0].sec', message: 'Converted "7.5" to a number' },
    ]);
  });

  it.each(['10 s', '1,000', '1e3', ' 5', '', 'twelve', '.5', '05'])(
    'leaves %j for validation to report',
    (value) => {
      const result = normalizeJsonText(
        JSON.stringify({ targetSec: value, label: 'x', beats: [] }),
        {
          schema,
        },
      );
      expect(result).toMatchObject({ ok: true, value: { targetSec: value }, fixes: [] });
    },
  );

  it('does not enter union branches (that would be a guess)', () => {
    const result = normalizeJsonText('{"targetSec":1,"label":"x","beats":[],"either":"3"}', {
      schema,
    });
    expect(result).toMatchObject({ ok: true, value: { either: '3' }, fixes: [] });
  });
});
