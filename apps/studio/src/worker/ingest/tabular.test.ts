import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk.ts';
import { extractCsv, parseCsv } from './csv.ts';
import { extractDocx } from './docx.ts';
import { SourceIngestError } from './errors.ts';
import { extractDocument, uploadFormat } from './extract.ts';
import { buildDocx } from './fixtures/docx-builder.ts';
import { extractJson } from './json.ts';
import { normalizeText } from './normalize.ts';
import { labelledRows } from './tables.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe('labelledRows', () => {
  it('names the columns once, then each row with every value under its column', () => {
    expect(
      labelledRows(
        ['Broker', '', 'Lag'],
        [
          ['north-1', 'x', ''],
          ['', '', ''],
        ],
      ),
    ).toBe('Columns: Broker; Column 2; Lag\n\n- Broker: north-1; Column 2: x');
  });
});

describe('CSV', () => {
  it('reads quoted fields: delimiters, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });

  it('takes the delimiter the header uses most (semicolon, tab)', () => {
    expect(parseCsv('x;y\n1,5;2')).toEqual([
      ['x', 'y'],
      ['1,5', '2'],
    ]);
    expect(parseCsv('x\ty\n1\t2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('keeps every row citable on its own: each value under its column name, one row a paragraph', () => {
    const { title, text } = extractCsv(fixture('broker-latency.csv').toString('utf8'));
    expect(title).toBeNull();
    expect(text).toContain('Columns: Broker; Region; Partitions; p99 latency (ms); Note');
    expect(text).toContain(
      '- Broker: south-1; Region: ap-south; Partitions: 32; p99 latency (ms): 41; Note: queue depth peaks at 9,500 messages',
    );
    expect(text).toContain(
      '- Broker: north-2; Region: eu-north; Partitions: 64; p99 latency (ms): 19\n',
    );
    expect(text).toContain('Note: replica lag "spiky" at night');
  });

  it('chunks whole rows: a row never spans two chunks', () => {
    const rows = Array.from({ length: 80 }, (_, i) => `node-${i + 1},${(i + 1) * 7},ok`);
    const text = normalizeText(extractCsv(`Node,Depth,State\n${rows.join('\n')}`).text);
    const chunks = chunkText(9, text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const line of chunk.text.split('\n\n')) expect(line).toMatch(/^(Columns: |- Node: )/);
    }
  });
});

describe('JSON', () => {
  it('turns a list of records into labelled rows and an object into key: value lines', () => {
    const { text } = extractJson(fixture('broker-config.json').toString('utf8'));
    expect(text.split('\n\n')).toEqual([
      'cluster: quillmark-events',
      '# retention',
      'hours: 72\nmaxBytes: 1.5 GB',
      '# brokers',
      'Columns: id; partitions; limits.inflight; tags',
      '- id: north-1; partitions: 48; limits.inflight: 5',
      '- id: south-1; partitions: 32; limits.inflight: 3; tags: edge, ssd',
    ]);
  });

  it('fails a file that does not parse with what to do', () => {
    expect(() => extractJson('{"a": 1,')).toThrow(SourceIngestError);
    expect(() => extractJson('{"a": 1,')).toThrow(/does not parse .* paste its content as text/);
  });
});

describe('Word (.docx)', () => {
  it('keeps headings and paragraphs; tables become labelled rows; the title is the first heading', async () => {
    const bytes = buildDocx([
      { heading: 'Queue sizing notes' },
      { paragraph: 'Each broker keeps a bounded queue per partition.' },
      { heading: 'Measured', level: 2 },
      {
        table: [
          ['Broker', 'p99 latency (ms)'],
          ['north-1', '12'],
          ['south-1', '41'],
        ],
      },
    ]);
    const doc = await extractDocx(bytes);
    expect(doc.title).toBe('Queue sizing notes');
    expect(doc.text).toBe(
      [
        '# Queue sizing notes',
        'Each broker keeps a bounded queue per partition.',
        '## Measured',
        'Columns: Broker; p99 latency (ms)',
        '- Broker: north-1; p99 latency (ms): 12',
        '- Broker: south-1; p99 latency (ms): 41',
      ].join('\n\n'),
    );
  });

  it('fails a file that is not a Word document as unreadable', async () => {
    const error = await extractDocx(new TextEncoder().encode('not a zip')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceIngestError);
    expect((error as SourceIngestError).code).toBe('unreadable');
  });
});

describe('uploads by extension', () => {
  it('reads .docx, .csv and .json uploads through their own extractors', async () => {
    expect([uploadFormat('a.DOCX'), uploadFormat('b.csv'), uploadFormat('c.json')]).toEqual([
      'docx',
      'csv',
      'json',
    ]);
    const doc = await extractDocument({
      bytes: fixture('broker-latency.csv'),
      format: 'csv',
      contentType: null,
      url: 'file:///upload',
    });
    expect(doc.text).toContain('- Broker: north-1;');
  });
});
