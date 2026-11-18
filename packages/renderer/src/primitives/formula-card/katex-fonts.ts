import 'katex/dist/katex.min.css';
import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';

/**
 * KaTeX fonts. EXCEPTION to the fonts rule (committed `.woff2` in `public/fonts`): KaTeX ships
 * about 20 faces with its CSS, so the stylesheet is imported and Remotion's webpack bundles the
 * font files from the pinned `katex` package. Nothing loads from the network.
 *
 * Faces load lazily, so a frame waits (`delayRender`) until the ones formulas use are ready.
 */
const FACES = [
  '1em KaTeX_Main',
  'bold 1em KaTeX_Main',
  'italic 1em KaTeX_Main',
  'italic 1em KaTeX_Math',
  '1em KaTeX_AMS',
  '1em KaTeX_Size1',
  '1em KaTeX_Size2',
  '1em KaTeX_Size3',
  '1em KaTeX_Size4',
];

let loading: Promise<unknown> | undefined;

function loadKatexFonts(): Promise<unknown> {
  loading ??= Promise.all(FACES.map((face) => document.fonts.load(face))).then(
    () => document.fonts.ready,
  );
  return loading;
}

/** Holds the render until KaTeX's faces have loaded. */
export function useKatexFonts(): void {
  const [handle] = useState(() => delayRender('Loading KaTeX fonts'));
  useEffect(() => {
    loadKatexFonts().then(
      () => continueRender(handle),
      () => continueRender(handle),
    );
  }, [handle]);
}
