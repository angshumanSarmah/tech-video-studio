import {
  ASSET_FILL_TOKENS,
  ASSET_GEOMETRY_ATTRS,
  ASSET_MAX_SHAPES,
  ASSET_SHAPE_TAGS,
  ASSET_STROKE_TOKENS,
  AssetShapeSchema,
  type AssetShape,
} from '@explainer-studio/shared';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * The house SVG format (rules in `docs/asset-style.md`): one `<svg>` with a 24×24 viewBox and a
 * flat list of shapes using geometry attributes and palette tokens only. The root carries the
 * stroke style; the renderer sets it again when drawing, so files cannot change it.
 *
 * Files are parsed into `AssetShape`s and drawn from those (never as raw markup), so anything
 * outside the format is rejected here; `sanitizeAssetSvg` (P1C.12) cleans other people's files.
 */

export const HOUSE_VIEWBOX = 24;
/** Version of the house style rules; assets record the version they were drawn to. */
export const HOUSE_STYLE_VERSION = 1;
/** Largest house SVG file, in bytes. */
export const HOUSE_MAX_BYTES = 16 * 1024;

const VIEWBOX_VALUE = `0 0 ${HOUSE_VIEWBOX} ${HOUSE_VIEWBOX}`;

/** Root attributes and the only values they may take (`*`: any value, ignored when drawn). */
const ROOT_ATTRS: Record<string, readonly string[] | '*'> = {
  xmlns: ['http://www.w3.org/2000/svg'],
  viewBox: [VIEWBOX_VALUE],
  width: '*',
  height: '*',
  fill: ['none'],
  stroke: ['currentColor'],
  'stroke-width': '*',
  'stroke-linecap': ['round'],
  'stroke-linejoin': ['round'],
};

const SHAPE_ATTRS = new Set<string>([...ASSET_GEOMETRY_ATTRS, 'fill', 'stroke']);
const SHAPE_TAGS = new Set<string>(ASSET_SHAPE_TAGS);

export type HouseSvgResult = { ok: true; shapes: AssetShape[] } | { ok: false; problems: string[] };

type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
  commentPropName: '#comment',
});

/** Parses a house SVG file into shapes, or lists every way it breaks the format. */
export function parseHouseSvg(text: string): HouseSvgResult {
  if (new TextEncoder().encode(text).length > HOUSE_MAX_BYTES) {
    return fail([`File is larger than ${HOUSE_MAX_BYTES} bytes.`]);
  }
  const valid = XMLValidator.validate(text);
  if (valid !== true) return fail([`Not well-formed XML: ${valid.err.msg}`]);
  const roots = (parser.parse(text) as XmlNode[]).filter((n) => !isIgnorable(n));
  const [root, ...extra] = roots;
  if (!root || nodeTag(root) !== 'svg' || extra.length > 0) {
    return fail(['Expected exactly one <svg> root element.']);
  }
  const problems = rootProblems(root[':@'] ?? {});
  const shapes = childNodes(root).flatMap((node, i) => {
    const shape = readShape(node, i);
    if ('problem' in shape) problems.push(shape.problem);
    return 'shape' in shape ? [shape.shape] : [];
  });
  if (shapes.length === 0) problems.push('No shapes.');
  if (shapes.length > ASSET_MAX_SHAPES) problems.push(`More than ${ASSET_MAX_SHAPES} shapes.`);
  return problems.length > 0 ? fail(problems) : { ok: true, shapes };
}

/** The canonical house SVG text for a list of shapes. */
export function serializeHouseSvg(shapes: readonly AssetShape[]): string {
  const body = shapes.map((s) => `  <${s.tag}${attrText(s.attrs)} />`).join('\n');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX_VALUE}" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n` +
    `${body}\n</svg>\n`
  );
}

/** One `[tag, attrs]` element of an icon set's node list (Lucide's `IconNode`). */
export type IconNodeElement = readonly [
  string,
  Readonly<Record<string, string | number | undefined>>,
];

/**
 * Restyles an icon set's node list to house shapes: keeps geometry, maps colour attributes to
 * palette tokens (`currentColor` stays; anything else becomes a stroke-only shape) and drops the
 * rest (keys, sizes, stroke widths: the renderer sets those). Throws on tags outside the format,
 * so a seed entry that cannot be restyled fails the registry build.
 */
export function restyleIconNode(name: string, node: readonly IconNodeElement[]): AssetShape[] {
  return node.map(([tag, attrs]) => {
    if (!SHAPE_TAGS.has(tag)) throw new Error(`Icon "${name}" uses <${tag}>, not a house shape.`);
    const kept: Record<string, string> = {};
    for (const [attr, value] of Object.entries(attrs)) {
      if (value === undefined) continue;
      if ((ASSET_GEOMETRY_ATTRS as readonly string[]).includes(attr)) kept[attr] = String(value);
    }
    if (attrs.fill === 'currentColor') kept.fill = 'currentColor';
    if (attrs.stroke === 'none') kept.stroke = 'none';
    return AssetShapeSchema.parse({ tag, attrs: kept });
  });
}

function rootProblems(attrs: Record<string, string>): string[] {
  const problems = Object.entries(attrs).flatMap(([attr, value]) => {
    const allowed = ROOT_ATTRS[attr];
    if (!allowed) return [`<svg> attribute "${attr}" is not allowed.`];
    if (allowed !== '*' && !allowed.includes(value)) {
      return [`<svg> ${attr}="${value}" must be ${allowed.join(' or ')}.`];
    }
    return [];
  });
  if (attrs.viewBox === undefined) problems.push(`<svg> needs viewBox="${VIEWBOX_VALUE}".`);
  return problems;
}

function readShape(node: XmlNode, i: number): { shape: AssetShape } | { problem: string } {
  const tag = nodeTag(node);
  if (tag === '#text') return { problem: `Text content is not allowed (shape ${i}).` };
  if (!tag || !SHAPE_TAGS.has(tag)) {
    return { problem: `<${tag ?? '?'}> is not allowed; use ${ASSET_SHAPE_TAGS.join(', ')}.` };
  }
  if (childNodes(node).length > 0) return { problem: `<${tag}> must be empty (shape ${i}).` };
  const attrs = node[':@'] ?? {};
  const unknown = Object.keys(attrs).filter((a) => !SHAPE_ATTRS.has(a));
  if (unknown.length > 0) {
    return { problem: `<${tag}> attribute(s) ${unknown.join(', ')} not allowed (shape ${i}).` };
  }
  const parsed = AssetShapeSchema.safeParse({ tag, attrs });
  if (parsed.success) return { shape: parsed.data };
  return {
    problem:
      `<${tag}> colours must be palette tokens (fill: ${ASSET_FILL_TOKENS.join(', ')}; ` +
      `stroke: ${ASSET_STROKE_TOKENS.join(', ')}) (shape ${i}).`,
  };
}

function nodeTag(node: XmlNode): string | undefined {
  return Object.keys(node).find((k) => k !== ':@');
}

function childNodes(node: XmlNode): XmlNode[] {
  const tag = nodeTag(node);
  const children = tag ? node[tag] : undefined;
  return Array.isArray(children) ? (children as XmlNode[]).filter((n) => !isIgnorable(n)) : [];
}

/** The XML declaration, comments and whitespace-only text carry nothing. */
function isIgnorable(node: XmlNode): boolean {
  const tag = nodeTag(node);
  if (tag === '?xml' || tag === '#comment') return true;
  return tag === '#text' && String(node['#text']).trim() === '';
}

function attrText(attrs: Record<string, string | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(v as string)}"`)
    .join('');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function fail(problems: string[]): HouseSvgResult {
  return { ok: false, problems };
}
