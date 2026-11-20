/**
 * Builds a minimal, valid PDF (Helvetica text in any size, one content stream per page, an
 * optional Info title), so the saved fixture can be regenerated and tests can make edge cases
 * (no text layer, no title).
 * Regenerate the fixture with: `pnpm exec tsx src/worker/ingest/fixtures/pdf-builder.ts`.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A line of text: plain (body size, 11 pt) or with its own font size. A `rotated` line is set
 * apart, running up the left margin (like a repository's ID stamp). ASCII only.
 */
export type PdfLine =
  string | { readonly text: string; readonly size: number; readonly rotated?: boolean };

export interface PdfSpec {
  /** The Info dictionary's title; omitted, the PDF has none. */
  readonly title?: string;
  /** Lines per page; an empty string is a blank line. */
  readonly pages: readonly (readonly PdfLine[])[];
}

const BODY_SIZE = 11;

export function buildPdf({ title, pages }: PdfSpec): Uint8Array {
  const pageIds = pages.map((_, i) => 5 + i * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    title === undefined ? '<< >>' : `<< /Title (${escape(title)}) /Producer (pdf-builder) >>`,
  ];
  for (const [i, lines] of pages.entries()) {
    const stream = contentStream(lines);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\n`;
  body += `startxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function contentStream(lines: readonly PdfLine[]): string {
  const sized = lines.map((line) =>
    typeof line === 'string' ? { text: line, size: BODY_SIZE, rotated: false } : line,
  );
  const upright = sized.filter((line) => !line.rotated);
  const ops = upright.map(({ text, size }) => {
    const leading = Math.round(size * 1.4);
    return `/F1 ${size} Tf ${leading} TL ${text === '' ? '' : `(${escape(text)}) Tj `}T*`;
  });
  const stamps = sized
    .filter((line) => line.rotated)
    .map(({ text, size }) => `BT /F1 ${size} Tf 0 1 -1 0 36 200 Tm (${escape(text)}) Tj ET`);
  const body = upright.length > 0 ? [`BT 72 740 Td ${ops.join(' ')} ET`] : [];
  return [...body, ...stamps].join('\n');
}

function escape(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/**
 * The saved fixture: an invented two-page note on consistent hashing. It has no Info title, so
 * its title comes from its largest text: a heading set over two lines.
 */
export const FIXTURE_PDF: PdfSpec = {
  pages: [
    [
      { text: 'Consistent Hashing', size: 22 },
      { text: 'Field Notes', size: 22 },
      '',
      'A hash ring maps both keys and servers onto the same circle of 2^32 positions.',
      'Each key belongs to the first server found clockwise from the key position.',
      'When a server joins, only the keys between it and its predecessor move.',
      'With N servers, adding one moves about 1/N of the keys instead of nearly all of them.',
      '',
      'Virtual nodes give each physical server many positions on the ring.',
      'In our example cluster, 160 virtual nodes per server kept the load within',
      'plus or minus 8 percent of the mean across 12 servers.',
    ],
    [
      { text: 'Failure handling', size: 16 },
      '',
      'When a server leaves, its keys fall to the next server clockwise.',
      'Replication places each key on the next 3 distinct physical servers.',
      'A read repair pass fixes replicas that missed writes while a server was down.',
      'Rebalancing is throttled to 40 MB per second so client latency stays flat.',
    ],
  ],
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('./hashing-notes.pdf', import.meta.url);
  writeFileSync(out, buildPdf(FIXTURE_PDF));
  console.log(`wrote ${fileURLToPath(out)}`);
}
