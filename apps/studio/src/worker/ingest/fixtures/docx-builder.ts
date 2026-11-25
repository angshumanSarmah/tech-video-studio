import { crc32 } from 'node:zlib';

/**
 * Builds a minimal Word document (.docx) for tests: headings, paragraphs and tables in a zip
 * whose entries are stored uncompressed. Only what a reader needs: content types, the package
 * relationship and the document body. Text is escaped; no styles beyond the heading style ids.
 */

export type DocxBlock =
  | { readonly heading: string; readonly level?: 1 | 2 }
  | { readonly paragraph: string }
  | { readonly table: readonly (readonly string[])[] };

export function buildDocx(blocks: readonly DocxBlock[]): Uint8Array {
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', PACKAGE_RELS],
    ['word/document.xml', documentXml(blocks)],
  ]);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

function documentXml(blocks: readonly DocxBlock[]): string {
  const body = blocks.map(blockXml).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
}

function blockXml(block: DocxBlock): string {
  if ('heading' in block) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level ?? 1}"/></w:pPr>${run(block.heading)}</w:p>`;
  }
  if ('paragraph' in block) return `<w:p>${run(block.paragraph)}</w:p>`;
  const rows = block.table
    .map(
      (cells) => `<w:tr>${cells.map((c) => `<w:tc><w:p>${run(c)}</w:p></w:tc>`).join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl>${rows}</w:tbl>`;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A zip of stored (uncompressed) entries: local headers, then the central directory. */
function zip(entries: readonly (readonly [string, string])[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
