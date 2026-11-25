import { describe, expect, it } from 'vitest';
import { namesToAvoidOf, NamesToAvoidFileSchema, openNameSlots } from './names.ts';

describe('names-to-avoid file', () => {
  const file = NamesToAvoidFileSchema.parse({
    'an-incident': [
      { text: 'Acme', kind: 'brand' },
      { text: '', kind: 'brand', todo: 'The organisation.' },
      { text: 'Initech', kind: 'brand', todo: 'Filled in, todo kept.' },
    ],
    'a-product': [],
  });

  it('reads names, leaving out slots still empty', () => {
    expect(namesToAvoidOf(file['an-incident'])).toEqual([
      { text: 'Acme', kind: 'brand' },
      { text: 'Initech', kind: 'brand' },
    ]);
    expect(namesToAvoidOf(file['no-such-slug'])).toEqual([]);
  });

  it('lists the slots still to fill', () => {
    expect(openNameSlots(file)).toEqual([{ slug: 'an-incident', todo: 'The organisation.' }]);
  });

  it('refuses an empty name that is not a marked slot', () => {
    const empty = { x: [{ text: '', kind: 'brand' }] };
    expect(NamesToAvoidFileSchema.safeParse(empty).success).toBe(false);
    const blankTodo = { x: [{ text: '', kind: 'brand', todo: ' ' }] };
    expect(NamesToAvoidFileSchema.safeParse(blankTodo).success).toBe(false);
  });
});
