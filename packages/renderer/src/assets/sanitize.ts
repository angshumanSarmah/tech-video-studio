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
import { HOUSE_MAX_BYTES, HOUSE_VIEWBOX, parseHouseSvg, serializeHouseSvg } from './house-svg.ts';
import {
  hasLongDecimals,
  parsePathData,
  pathPoints,
  round2,
  roundedPathData,
  type Point,
} from './path-data.ts';

/**
 * The asset sanitizer (P1C.12): turns an SVG someone else wrote (a drafted variant, an upload)
 * into a house SVG (`docs/asset-style.md`), or says why it cannot. Anything that could act or
 * reach out (scripts, event handlers, links, external references, `foreignObject`, images,
 * styles, entities) is refused, never stripped: a file that carries it is not drawn. So are
 * gradients, filters, masks, text, transforms, colours other than the palette tokens and a
 * viewBox other than the house one. Harmless editor leftovers are fixed and reported: `title`,
 * `desc`, `metadata` and comments dropped, groups without effect flattened (their fill and stroke
 * passed to their shapes), ids, classes and stroke styles dropped (the renderer sets those).
 * `draft` mode rounds coordinates to two decimals (the drafter's rule; uploads, like the Lucide
 * set, keep their precision) and adds the drafter's limits and look checks
 * (inside the live area, large enough, stroked, one soft fill at most, solid fills only on small
 * marks, no repeated shape). The result is canonical `serializeHouseSvg` text, which
 * `parseHouseSvg` accepts. Pure.
 */

export type SanitizeMode = 'upload' | 'draft';

export type SanitizeResult =
  | {
      readonly ok: true;
      readonly svg: string;
      readonly shapes: AssetShape[];
      readonly fixes: string[];
    }
  | { readonly ok: false; readonly problems: string[]; readonly fixes: string[] };

export const SANITIZE_LIMITS: Readonly<
  Record<SanitizeMode, { inputBytes: number; shapes: number; pathChars: number }>
> = {
  upload: { inputBytes: 64 * 1024, shapes: ASSET_MAX_SHAPES, pathChars: 4000 },
  draft: { inputBytes: 8 * 1024, shapes: 32, pathChars: 2000 },
};

/** Bounds every coordinate must stay inside (the 24 box, with one unit of slack). */
const OUTER = { min: -1, max: HOUSE_VIEWBOX + 1 };
/** The drafter's live area (house padding 2-22, one unit of slack) and smallest glyph. */
const LIVE = { min: 1, max: HOUSE_VIEWBOX - 1 };
const MIN_GLYPH_SIDE = 8;
/** Solid `currentColor` fills only on marks smaller than this (units squared). */
const MAX_SOLID_AREA = 9;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_TAGS = new Set<string>(ASSET_SHAPE_TAGS);
const GEOMETRY = new Set<string>(ASSET_GEOMETRY_ATTRS);
const NUMERIC = new Set<string>(ASSET_GEOMETRY_ATTRS.filter((a) => a !== 'd' && a !== 'points'));
/** Elements dropped as harmless (they draw nothing). */
const DROPPED_ELEMENTS = new Set(['title', 'desc', 'metadata']);
/** Elements that run, style, load or link something: refused as unsafe, not just unsupported. */
const UNSAFE_ELEMENTS = new Set([
  'script',
  'style',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'image',
  'use',
  'a',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'feImage',
]);
/** Attributes dropped as harmless anywhere (the renderer sets stroke style itself). */
const DROPPED_ATTRS = new Set([
  'id',
  'class',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'fill-rule',
  'clip-rule',
  'role',
  'focusable',
  'version',
  'xml:space',
  'xmlns:xlink',
  'width',
  'height',
]);
/** What a house root carries anyway (the renderer sets it again): dropped without a note. */
const ROOT_SILENT = new Set([
  'width',
  'height',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
]);
/** Text anywhere in the file that could act or reach out: always refused. */
const DANGEROUS_TEXT: readonly [RegExp, string][] = [
  [/<!DOCTYPE/i, 'a DOCTYPE'],
  [/<!ENTITY/i, 'an entity declaration'],
  [/<!\[CDATA\[/i, 'a CDATA section'],
  [/javascript:/i, 'a javascript: URL'],
  [/data:/i, 'a data: URL'],
  [/url\s*\(/i, 'a url() reference'],
  [/expression\s*\(/i, 'a CSS expression'],
  [/@import/i, 'a CSS import'],
  [/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)[a-z]/i, 'an entity reference'],
];

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

export function sanitizeAssetSvg(text: string, mode: SanitizeMode = 'upload'): SanitizeResult {
  const limits = SANITIZE_LIMITS[mode];
  const fixes: string[] = [];
  const problems: string[] = [];
  const fail = (): SanitizeResult => ({ ok: false, problems: [...new Set(problems)], fixes });
  if (new TextEncoder().encode(text).length > limits.inputBytes) {
    problems.push(`The file is larger than ${limits.inputBytes / 1024} KB.`);
    return fail();
  }
  for (const [pattern, what] of DANGEROUS_TEXT) {
    if (pattern.test(text)) problems.push(`Refused: the file contains ${what}.`);
  }
  if (processingInstructions(text)) problems.push('Refused: a processing instruction.');
  if (problems.length > 0) return fail();
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    problems.push(`Not well-formed XML: ${valid.err.msg}`);
    return fail();
  }
  const roots = (parser.parse(text) as XmlNode[]).filter((n) => !isDeclarationOrBlank(n, fixes));
  const [root, ...extra] = roots;
  if (!root || tagOf(root) !== 'svg' || extra.length > 0) {
    problems.push('Expected exactly one <svg> root element.');
    return fail();
  }
  const inherited = rootPaint(root[':@'] ?? {}, problems, fixes);
  const geometry: GeometryOptions = { pathChars: limits.pathChars, round: mode === 'draft' };
  const shapes = collectShapes(childrenOf(root), inherited, problems, fixes, geometry);
  if (shapes.length === 0) problems.push('No shapes to draw.');
  if (shapes.length > limits.shapes) problems.push(`More than ${limits.shapes} shapes.`);
  if (problems.length > 0) return fail();
  problems.push(...geometryProblems(shapes, mode));
  if (problems.length > 0) return fail();
  const svg = serializeHouseSvg(shapes);
  if (new TextEncoder().encode(svg).length > HOUSE_MAX_BYTES) {
    problems.push(`The cleaned file is larger than ${HOUSE_MAX_BYTES / 1024} KB.`);
    return fail();
  }
  const check = parseHouseSvg(svg);
  if (!check.ok) {
    problems.push(...check.problems);
    return fail();
  }
  return { ok: true, svg, shapes: check.shapes, fixes: [...new Set(fixes)] };
}

/** `<?...?>` other than one XML declaration at the very start. */
function processingInstructions(text: string): boolean {
  const all = [...text.matchAll(/<\?/g)].map((m) => m.index);
  const declaration = /^\s*<\?xml[\s?]/i.test(text) ? text.indexOf('<?') : -1;
  return all.some((at) => at !== declaration);
}

type Paint = { fill?: string; stroke?: string };

/** Path length limit, and whether coordinates are rounded to two decimals (drafts only). */
type GeometryOptions = { readonly pathChars: number; readonly round: boolean };

/** The root's own attributes: the namespace and viewBox checked, paint passed down, the rest dropped. */
function rootPaint(attrs: Record<string, string>, problems: string[], fixes: string[]): Paint {
  if (attrs.xmlns !== undefined && attrs.xmlns !== SVG_NS) {
    problems.push(`<svg> xmlns must be ${SVG_NS}.`);
  }
  const viewBox = attrs.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
    .join(' ');
  if (viewBox !== `0 0 ${HOUSE_VIEWBOX} ${HOUSE_VIEWBOX}`) {
    problems.push(`<svg> needs viewBox="0 0 ${HOUSE_VIEWBOX} ${HOUSE_VIEWBOX}" (the house grid).`);
  }
  const paint: Paint = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'xmlns' || name === 'viewBox' || ROOT_SILENT.has(name)) continue;
    if (name === 'fill' || name === 'stroke') {
      const token = paintToken(name, value, '<svg>', problems, fixes);
      if (token !== undefined) paint[name] = token;
    } else {
      attributeOutcome(name, '<svg>', problems, fixes);
    }
  }
  return paint;
}

/** Shapes in document order: groups without effect flattened, harmless elements dropped. */
function collectShapes(
  nodes: readonly XmlNode[],
  inherited: Paint,
  problems: string[],
  fixes: string[],
  geometry: GeometryOptions,
): AssetShape[] {
  return nodes.flatMap((node): AssetShape[] => {
    const tag = tagOf(node);
    if (tag === '#comment') {
      fixes.push('Comments dropped.');
      return [];
    }
    if (tag === '#text') {
      if (String(node['#text']).trim() !== '') problems.push('Text content is not allowed.');
      return [];
    }
    if (tag === undefined) return [];
    if (DROPPED_ELEMENTS.has(tag)) {
      fixes.push(`<${tag}> dropped.`);
      return [];
    }
    if (tag === 'g') {
      const paint = groupPaint(node[':@'] ?? {}, inherited, problems, fixes);
      fixes.push('Groups flattened.');
      return collectShapes(childrenOf(node), paint, problems, fixes, geometry);
    }
    if (UNSAFE_ELEMENTS.has(tag)) {
      problems.push(`Refused: <${tag}> is not allowed in an asset.`);
      return [];
    }
    if (!SHAPE_TAGS.has(tag)) {
      problems.push(`<${tag}> is not allowed; use ${ASSET_SHAPE_TAGS.join(', ')}.`);
      return [];
    }
    const shape = readShape(tag, node, inherited, problems, fixes, geometry);
    return shape ? [shape] : [];
  });
}

function groupPaint(
  attrs: Record<string, string>,
  inherited: Paint,
  problems: string[],
  fixes: string[],
): Paint {
  const paint = { ...inherited };
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'fill' || name === 'stroke') {
      const token = paintToken(name, value, '<g>', problems, fixes);
      if (token !== undefined) paint[name] = token;
    } else {
      attributeOutcome(name, '<g>', problems, fixes);
    }
  }
  return paint;
}

function readShape(
  tag: string,
  node: XmlNode,
  inherited: Paint,
  problems: string[],
  fixes: string[],
  geometry: GeometryOptions,
): AssetShape | undefined {
  const where = `<${tag}>`;
  for (const child of childrenOf(node)) {
    const childTag = tagOf(child);
    if (childTag && DROPPED_ELEMENTS.has(childTag)) fixes.push(`<${childTag}> dropped.`);
    else if (childTag && UNSAFE_ELEMENTS.has(childTag)) {
      problems.push(`Refused: <${childTag}> is not allowed in an asset.`);
    } else if (childTag !== '#comment') problems.push(`${where} must be empty.`);
  }
  const kept: Record<string, string> = {};
  if (inherited.fill !== undefined) kept.fill = inherited.fill;
  if (inherited.stroke !== undefined) kept.stroke = inherited.stroke;
  for (const [name, value] of Object.entries(node[':@'] ?? {})) {
    if (name === 'fill' || name === 'stroke') {
      const token = paintToken(name, value, where, problems, fixes);
      if (token !== undefined) kept[name] = token;
    } else if (GEOMETRY.has(name)) {
      const v = geometryValue(name, value, where, problems, fixes, geometry);
      if (v !== undefined) kept[name] = v;
    } else {
      attributeOutcome(name, where, problems, fixes);
    }
  }
  if (kept.fill === 'none') delete kept.fill;
  if (kept.stroke === 'currentColor') delete kept.stroke;
  const parsed = AssetShapeSchema.safeParse({ tag, attrs: kept });
  if (!parsed.success) {
    problems.push(`${where} is not a valid house shape.`);
    return undefined;
  }
  return parsed.data;
}

/** A fill or stroke as a palette token (case of `currentColor` fixed), else a problem. */
function paintToken(
  name: 'fill' | 'stroke',
  value: string,
  where: string,
  problems: string[],
  fixes: string[],
): string | undefined {
  const allowed: readonly string[] = name === 'fill' ? ASSET_FILL_TOKENS : ASSET_STROKE_TOKENS;
  const v = value.trim();
  if (allowed.includes(v)) return v;
  const fixed = allowed.find((token) => token.toLowerCase() === v.toLowerCase());
  if (fixed !== undefined) {
    fixes.push(`${name}="${v}" read as ${fixed}.`);
    return fixed;
  }
  problems.push(
    `${where} ${name}="${v}" is not a palette token (allowed: ${allowed.join(', ')}); colours come from the theme.`,
  );
  return undefined;
}

/** Any attribute that is not paint or geometry: dropped when harmless, else a problem. */
function attributeOutcome(name: string, where: string, problems: string[], fixes: string[]): void {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) problems.push(`Refused: ${where} has an event handler (${name}).`);
  else if (lower === 'href' || lower.endsWith(':href') || lower === 'src') {
    problems.push(`Refused: ${where} links to something (${name}).`);
  } else if (lower === 'style')
    problems.push(`${where} style is not allowed (use palette tokens).`);
  else if (lower === 'transform') {
    problems.push(`${where} transform is not allowed: write the coordinates out.`);
  } else if (DROPPED_ATTRS.has(lower) || lower.startsWith('data-') || lower.startsWith('aria-')) {
    fixes.push(`${name} dropped.`);
  } else problems.push(`${where} attribute "${name}" is not allowed.`);
}

function geometryValue(
  name: string,
  value: string,
  where: string,
  problems: string[],
  fixes: string[],
  { pathChars, round }: GeometryOptions,
): string | undefined {
  const v = value.trim();
  if (name === 'd') {
    if (v.length > pathChars) {
      problems.push(`${where} path data is longer than ${pathChars} characters.`);
      return undefined;
    }
    const parsed = parsePathData(v);
    if ('problem' in parsed) {
      problems.push(`${where} d: ${parsed.problem}`);
      return undefined;
    }
    if (!round || !hasLongDecimals(parsed.segments)) return v;
    fixes.push('Coordinates rounded to two decimals.');
    return roundedPathData(parsed.segments);
  }
  if (name === 'points') {
    const numbers = v.split(/[\s,]+/).filter((s) => s !== '');
    if (numbers.length < 4 || numbers.length % 2 !== 0 || !numbers.every(isPlainNumber)) {
      problems.push(`${where} points must be pairs of plain numbers.`);
      return undefined;
    }
    return round ? roundedList(numbers, fixes) : v;
  }
  if (NUMERIC.has(name)) {
    if (!isPlainNumber(v)) {
      problems.push(`${where} ${name}="${v}" must be a plain number (no units).`);
      return undefined;
    }
    return round ? roundedList([v], fixes) : v;
  }
  return v;
}

function roundedList(numbers: readonly string[], fixes: string[]): string {
  const rounded = numbers.map((n) => round2(Number(n)));
  if (rounded.some((r, i) => r !== Number(numbers[i]))) {
    fixes.push('Coordinates rounded to two decimals.');
  }
  return rounded.join(numbers.length > 1 ? ' ' : '');
}

const isPlainNumber = (s: string) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s);

// ---------------------------------------------------------------------------------------------
// Geometry: extent always; the drafter's look checks in `draft` mode

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function geometryProblems(shapes: readonly AssetShape[], mode: SanitizeMode): string[] {
  const boxes = shapes.map(shapeBox);
  const problems: string[] = [];
  const outside = boxes.some(
    (b) =>
      b && (b.minX < OUTER.min || b.minY < OUTER.min || b.maxX > OUTER.max || b.maxY > OUTER.max),
  );
  if (outside) problems.push(`A shape reaches outside the ${HOUSE_VIEWBOX}×${HOUSE_VIEWBOX} box.`);
  if (mode === 'upload' || problems.length > 0) return problems;
  return [...problems, ...draftProblems(shapes, boxes)];
}

function draftProblems(
  shapes: readonly AssetShape[],
  boxes: readonly (Box | undefined)[],
): string[] {
  const problems: string[] = [];
  const all = union(boxes);
  if (
    all &&
    (all.minX < LIVE.min || all.minY < LIVE.min || all.maxX > LIVE.max || all.maxY > LIVE.max)
  ) {
    problems.push(`The glyph touches the edge: keep every coordinate inside 2-22.`);
  }
  if (all && Math.max(all.maxX - all.minX, all.maxY - all.minY) < MIN_GLYPH_SIDE) {
    problems.push(`The glyph is too small: make its longer side at least ${MIN_GLYPH_SIDE} units.`);
  }
  if (!shapes.some((s) => s.attrs.stroke !== 'none')) {
    problems.push('Nothing is stroked: the house style is line-drawn.');
  }
  if (shapes.filter((s) => s.attrs.fill === 'var(--asset-fill)').length > 1) {
    problems.push('More than one shape uses var(--asset-fill).');
  }
  shapes.forEach((s, i) => {
    const b = boxes[i];
    if (
      s.attrs.fill === 'currentColor' &&
      b &&
      (b.maxX - b.minX) * (b.maxY - b.minY) >= MAX_SOLID_AREA
    ) {
      problems.push(
        `<${s.tag}> (shape ${i}) is a large solid fill: solid fills are for small marks only.`,
      );
    }
  });
  const seen = new Set<string>();
  shapes.forEach((s, i) => {
    const key = JSON.stringify(s);
    if (seen.has(key)) problems.push(`<${s.tag}> (shape ${i}) repeats an earlier shape.`);
    seen.add(key);
  });
  return problems;
}

function shapeBox(shape: AssetShape): Box | undefined {
  const a = shape.attrs;
  const n = (v: string | undefined) => Number(v ?? 0);
  switch (shape.tag) {
    case 'circle':
      return box([
        { x: n(a.cx) - n(a.r), y: n(a.cy) - n(a.r) },
        { x: n(a.cx) + n(a.r), y: n(a.cy) + n(a.r) },
      ]);
    case 'ellipse':
      return box([
        { x: n(a.cx) - n(a.rx), y: n(a.cy) - n(a.ry) },
        { x: n(a.cx) + n(a.rx), y: n(a.cy) + n(a.ry) },
      ]);
    case 'rect':
      return box([
        { x: n(a.x), y: n(a.y) },
        { x: n(a.x) + n(a.width), y: n(a.y) + n(a.height) },
      ]);
    case 'line':
      return box([
        { x: n(a.x1), y: n(a.y1) },
        { x: n(a.x2), y: n(a.y2) },
      ]);
    case 'polyline':
    case 'polygon': {
      const v = (a.points ?? '')
        .split(/[\s,]+/)
        .filter((s) => s !== '')
        .map(Number);
      return box(
        Array.from({ length: v.length / 2 }, (_, k) => ({ x: v[2 * k]!, y: v[2 * k + 1]! })),
      );
    }
    case 'path': {
      const parsed = parsePathData(a.d ?? '');
      return 'segments' in parsed ? box(pathPoints(parsed.segments)) : undefined;
    }
  }
}

function box(points: readonly Point[]): Box | undefined {
  if (points.length === 0) return undefined;
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function union(boxes: readonly (Box | undefined)[]): Box | undefined {
  const known = boxes.filter((b): b is Box => b !== undefined);
  if (known.length === 0) return undefined;
  return {
    minX: Math.min(...known.map((b) => b.minX)),
    minY: Math.min(...known.map((b) => b.minY)),
    maxX: Math.max(...known.map((b) => b.maxX)),
    maxY: Math.max(...known.map((b) => b.maxY)),
  };
}

// ---------------------------------------------------------------------------------------------
// XML nodes

function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((k) => k !== ':@');
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const children = tag ? node[tag] : undefined;
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

/** The XML declaration, comments and blank text before or after the root carry nothing. */
function isDeclarationOrBlank(node: XmlNode, fixes: string[]): boolean {
  const tag = tagOf(node);
  if (tag === '?xml') return true;
  if (tag === '#comment') {
    fixes.push('Comments dropped.');
    return true;
  }
  return tag === '#text' && String(node['#text']).trim() === '';
}
