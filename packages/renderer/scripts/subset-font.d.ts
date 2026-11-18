// subset-font ships no types; only the options the subset script uses are declared.
declare module 'subset-font' {
  type Options = {
    targetFormat?: 'woff2' | 'woff' | 'truetype' | 'sfnt';
    variationAxes?: Record<string, number | { min: number; max: number; default?: number }>;
  };
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: Options,
  ): Promise<Buffer>;
}
