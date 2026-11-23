import { containsPhrase } from '../text/phrase.ts';

/**
 * Words that label numbers as an example rather than the story's own system ("for example, a
 * bucket holds one hundred tokens"). One list, read by `example_not_labelled` and its messages.
 */
export const EXAMPLE_MARKERS = [
  'for example',
  'say',
  'typically',
  'a typical',
  'imagine',
  'in one',
  'picture',
] as const;

/** Whether a text labels what follows as an example (whole words, any case). */
export function hasExampleMarker(text: string): boolean {
  return EXAMPLE_MARKERS.some((marker) => containsPhrase(text, marker));
}
