import { SourceChunkSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { CHUNK_MAX_CHARS, CHUNK_MIN_CHARS, CHUNK_TARGET_CHARS, chunkText } from './chunk.ts';

const sentence = (i: number) => `Sentence number ${i} explains one more detail of the mechanism.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');

describe('chunkText', () => {
  it('numbers chunks from 1 and makes each an exact slice of the text', () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i * 10, 5)).join('\n\n');
    const chunks = chunkText(7, text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => `source-7#chunk-${i + 1}`));
    for (const chunk of chunks) {
      expect(SourceChunkSchema.parse(chunk)).toEqual(chunk);
      expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  it('closes chunks at paragraph ends once they reach the target', () => {
    const text = Array.from({ length: 10 }, (_, i) => paragraph(i * 10, 4)).join('\n\n');
    const chunks = chunkText(1, text);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(CHUNK_TARGET_CHARS);
      expect(text.slice(chunk.end, chunk.end + 2)).toBe('\n\n');
    }
  });

  it('splits a paragraph longer than the max at sentence ends', () => {
    const text = paragraph(0, 80);
    const chunks = chunkText(1, text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.text.endsWith('mechanism.')).toBe(true);
    }
  });

  it('never ends a chunk on a heading: the heading moves to the text it introduces', () => {
    const text = [paragraph(0, 19), '## Failure handling', paragraph(100, 19)].join('\n\n');
    const chunks = chunkText(1, text);
    expect(chunks.some((c) => c.text.trimEnd().endsWith('## Failure handling'))).toBe(false);
    expect(chunks.some((c) => c.text.startsWith('## Failure handling\n\nSentence'))).toBe(true);
  });

  it('merges a short tail into the chunk before it when it fits', () => {
    const text = [paragraph(0, 20), 'A short closing line.'].join('\n\n');
    const chunks = chunkText(1, text);
    expect(chunks.at(-1)!.text.endsWith('A short closing line.')).toBe(true);
    expect(chunks.every((c) => c.text.length >= CHUNK_MIN_CHARS)).toBe(true);
  });

  it('is deterministic and keeps short text as one chunk', () => {
    const text = paragraph(0, 30);
    expect(chunkText(3, text)).toEqual(chunkText(3, text));
    expect(chunkText(3, 'One short paragraph.')).toEqual([
      { id: 'source-3#chunk-1', text: 'One short paragraph.', start: 0, end: 20 },
    ]);
  });
});
