import {
  LOGO_MAX_BYTES,
  LOGO_MAX_SIDE_PX,
  type LogoFile,
  type LogoMime,
  type LogoSlot,
} from '@explainer-studio/shared';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { resolveDataPath, runLogosDir } from '../data-files.ts';
import type { AssetProblem } from './library.ts';

/**
 * Logo files fill a run's logo slots: `runs/<id>/logos/<slot>.svg` or `.png`, supplied by the
 * user (upload is P1D.6, with the same limits). They are passed to the renderer as data URIs and
 * drawn as images in their own colours; nothing is ever fetched.
 */

export const LOGO_EXTENSIONS = { svg: 'image/svg+xml', png: 'image/png' } as const satisfies Record<
  string,
  LogoMime
>;
export type LogoExtension = keyof typeof LOGO_EXTENSIONS;

export type LogoCheck = { ok: true; mime: LogoMime } | { ok: false; problem: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Checks type, size (≤ 300 KB) and pixel size (≤ 1024 px on the longest side). */
export function checkLogoFile(bytes: Uint8Array, extension: LogoExtension): LogoCheck {
  if (bytes.length > LOGO_MAX_BYTES) {
    return { ok: false, problem: `Larger than ${LOGO_MAX_BYTES / 1024} KB.` };
  }
  const size = extension === 'png' ? pngSize(bytes) : svgSize(new TextDecoder().decode(bytes));
  if ('problem' in size) return { ok: false, problem: size.problem };
  if (Math.max(size.width, size.height) > LOGO_MAX_SIDE_PX) {
    return {
      ok: false,
      problem: `${size.width} × ${size.height} px; at most ${LOGO_MAX_SIDE_PX} px on the longest side.`,
    };
  }
  return { ok: true, mime: LOGO_EXTENSIONS[extension] };
}

type Size = { width: number; height: number } | { problem: string };

/** Width and height from the IHDR chunk, which must come first. */
function pngSize(bytes: Uint8Array): Size {
  const signed = PNG_SIGNATURE.every((b, i) => bytes[i] === b);
  const ihdr = new TextDecoder().decode(bytes.subarray(12, 16)) === 'IHDR';
  if (!signed || !ihdr || bytes.length < 24) return { problem: 'Not a PNG file.' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const svgParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
});

/**
 * Size from `width`/`height` (px or unitless) or the viewBox. Scripts and external references
 * are refused: an `<img>` would not run or fetch them, but a logo should not carry them.
 */
function svgSize(text: string): Size {
  if (XMLValidator.validate(text) !== true) return { problem: 'Not well-formed SVG.' };
  if (/<script\b|<foreignObject\b/i.test(text)) return { problem: 'SVG with scripts or HTML.' };
  if (/(?:href|src)\s*=\s*["']\s*(?!#|data:)/i.test(text)) {
    return { problem: 'SVG with external references (only #fragment and data: links).' };
  }
  const parsed: unknown = svgParser.parse(text);
  const root = (parsed as { svg?: Record<string, unknown> }).svg;
  if (!root || typeof root !== 'object') return { problem: 'No <svg> root element.' };
  const box = attrText(root.viewBox)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = pxLength(root.width) ?? box[2];
  const height = pxLength(root.height) ?? box[3];
  if (!isPositive(width) || !isPositive(height)) {
    return { problem: 'SVG needs a viewBox or width and height in px.' };
  }
  return { width, height };
}

function pxLength(value: unknown): number | undefined {
  const match = /^\s*([\d.]+)\s*(px)?\s*$/.exec(attrText(value));
  return match ? Number(match[1]) : undefined;
}

/** A parsed attribute's text; anything else (absent, an element) is empty. */
function attrText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function isPositive(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n) && n > 0;
}

export type LogoLoad = { logos: LogoFile[]; problems: AssetProblem[] };

/** The files filling `slots`; a slot without a file stays unfilled (a draft placeholder). */
export function loadLogoFiles(
  dataDir: string,
  runId: number,
  slots: readonly LogoSlot[],
): LogoLoad {
  const load: LogoLoad = { logos: [], problems: [] };
  for (const slot of slots) {
    const found = (Object.keys(LOGO_EXTENSIONS) as LogoExtension[])
      .map((ext) => ({ ext, path: posix.join(runLogosDir(runId), `${slot.id}.${ext}`) }))
      .filter((f) => existsSync(resolveDataPath(dataDir, f.path)));
    if (found.length > 1) {
      load.problems.push({ id: slot.id, message: 'Both an SVG and a PNG; keep one.' });
      continue;
    }
    const [file] = found;
    if (!file) continue;
    const bytes = readFileSync(resolveDataPath(dataDir, file.path));
    const check = checkLogoFile(bytes, file.ext);
    if (!check.ok) load.problems.push({ id: slot.id, message: `${file.path}: ${check.problem}` });
    else load.logos.push(logoFile(slot.id, check.mime, bytes));
  }
  return load;
}

function logoFile(id: string, mime: LogoMime, bytes: Uint8Array): LogoFile {
  return {
    kind: 'logo',
    id,
    mime,
    dataUri: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}
