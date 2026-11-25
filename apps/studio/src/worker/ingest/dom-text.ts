import { labelledRows } from './tables.ts';

/**
 * Turns an (already cleaned) DOM subtree into plain text that keeps the structure the chunker
 * and the Researcher need: one paragraph per block, headings as `#` lines, list items as `- `,
 * table rows as `a | b` (or, with `tables: 'labelled'`, as `labelledRows` under the first row's
 * names), preformatted text in fences. Inline markup is flattened.
 */

const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'HEADER',
  'HR',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'SECTION',
  'SUMMARY',
  'UL',
]);
const HEADING = /^H([1-6])$/;

export interface DomTextOptions {
  /** `rows` (default): `a | b` per row. `labelled`: the first row names the columns. */
  readonly tables?: 'rows' | 'labelled';
}

export function domToText(root: Node, options: DomTextOptions = {}): string {
  const writer = new BlockWriter(options.tables ?? 'rows');
  walk(root, writer);
  writer.flush();
  return writer.blocks.join('\n\n');
}

class BlockWriter {
  readonly blocks: string[] = [];
  constructor(readonly tables: 'rows' | 'labelled') {}
  private inline = '';
  private prefix = '';

  /** HTML whitespace (newlines included) collapses to one space; only `<br>` breaks a line. */
  text(value: string): void {
    this.inline += value.replace(/\s+/g, ' ');
  }

  lineBreak(): void {
    this.inline += '\n';
  }

  /** Starts a new block whose first line gets `prefix`. */
  start(prefix = ''): void {
    this.flush();
    this.prefix = prefix;
  }

  raw(block: string): void {
    this.flush();
    if (block.trim() !== '') this.blocks.push(block);
  }

  flush(): void {
    const text = this.inline
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (text !== '') this.blocks.push(this.prefix + text);
    this.inline = '';
    this.prefix = '';
  }
}

function walk(node: Node, out: BlockWriter): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === child.TEXT_NODE) out.text(child.nodeValue ?? '');
    else if (child.nodeType === child.ELEMENT_NODE) element(child as Element, out);
  }
}

function element(el: Element, out: BlockWriter): void {
  const tag = el.tagName.toUpperCase();
  const heading = HEADING.exec(tag);
  if (heading) {
    out.start(`${'#'.repeat(Number(heading[1]))} `);
    walk(el, out);
    out.flush();
  } else if (tag === 'BR') {
    out.lineBreak();
  } else if (tag === 'PRE') {
    out.raw(`\`\`\`\n${(el.textContent ?? '').replace(/\n+$/, '')}\n\`\`\``);
  } else if (tag === 'LI') {
    out.start(listMarker(el));
    walk(el, out);
    out.flush();
  } else if (tag === 'TABLE') {
    out.raw(tableText(el, out.tables));
  } else if (BLOCKS.has(tag)) {
    out.flush();
    walk(el, out);
    out.flush();
  } else {
    walk(el, out);
  }
}

function listMarker(li: Element): string {
  const list = li.parentElement;
  if (list?.tagName.toUpperCase() !== 'OL') return '- ';
  const items = Array.from(list.children).filter((c) => c.tagName.toUpperCase() === 'LI');
  return `${items.indexOf(li) + 1}. `;
}

function tableText(table: Element, style: 'rows' | 'labelled'): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
  const [header, ...body] = rows;
  if (style === 'labelled' && header && body.length > 0) return labelledRows(header, body);
  return rows
    .map((cells) => cells.join(' | '))
    .filter((line) => line.replace(/[\s|]/g, '') !== '')
    .join('\n');
}
