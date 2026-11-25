/**
 * Content words of a short text (a topic and its angle, a topic title), shared by the
 * Researcher's chunk selection and topic similarity. Pure.
 */

/** Words that say nothing about a topic. */
const STOPWORDS = new Set(
  (
    'the and for with how what why when where which who does doing done that this these those ' +
    'from into onto over under are was were been being its it’s their there they them then ' +
    'than about your you our not but can could should would will all any use used using uses ' +
    'work works working make makes made get gets via per each more most less also just only ' +
    'really very explain explained explainer video short shorts focus angle'
  ).split(' '),
);

/** Lowercase word tokens of at least 3 letters, plurals folded ("limiters" → "limiter"). */
export function termWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Distinct content words of a query (topic and angle), stopwords dropped. */
export function queryTerms(query: string): string[] {
  return [...new Set(termWords(query).filter((w) => !STOPWORDS.has(w)))];
}
