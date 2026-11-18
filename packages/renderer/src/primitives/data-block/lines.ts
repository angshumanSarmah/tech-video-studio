import type { DataField } from './definition.ts';

/** One field as printed: `  "key": value,`, split so each part can be coloured. */
export type DataLine = { indent: string; key: string; value: string; comma: string };

const INDENT = '  ';

export function formatDataValue(value: DataField['value']): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function dataLines(fields: readonly DataField[]): DataLine[] {
  return fields.map((field, i) => ({
    indent: INDENT,
    key: `${JSON.stringify(field.key)}: `,
    value: formatDataValue(field.value),
    comma: i < fields.length - 1 ? ',' : '',
  }));
}

export function lineText(line: DataLine): string {
  return line.indent + line.key + line.value + line.comma;
}

/** The parts of a line cut to its first `chars` characters, in order. */
export function visibleParts(line: DataLine, chars: number): DataLine {
  let left = chars;
  const take = (part: string) => {
    const shown = part.slice(0, Math.max(0, left));
    left -= part.length;
    return shown;
  };
  return {
    indent: take(line.indent),
    key: take(line.key),
    value: take(line.value),
    comma: take(line.comma),
  };
}
