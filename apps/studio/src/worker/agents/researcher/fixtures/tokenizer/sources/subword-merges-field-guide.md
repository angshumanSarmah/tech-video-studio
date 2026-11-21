# A field guide to subword merges

_Invented article written for the Explainer Studio test fixtures. The tokenizer, model and
numbers below are made up._

## What the model actually reads

A language model never sees letters. Before any text reaches it, a tokenizer turns the text into
a list of integers, one per token, and the model works only with those integers. On the way out,
the same tokenizer turns the integers the model produces back into text. Everything the model
"knows" about spelling, it has to learn from which pieces of text share which integers.

The tokenizer this guide follows is Saltmarsh, the invented tokenizer of an invented model
family. Its vocabulary, the fixed list of pieces it can output, has 32,000 entries.

## Why not letters, and why not words

There are two obvious ways to cut text, and both fail. Cutting into single characters keeps the
vocabulary tiny, but a paragraph becomes thousands of steps long, and the model must spend its
fixed context on spelling. Cutting into whole words keeps sequences short, but the vocabulary
explodes: every name, typo and new word needs its own entry, and a word that was never seen
during training has no integer at all.

Subword tokenizers sit between the two. Frequent words get a single token of their own; rare
words are spelled out from smaller pieces that the vocabulary does have.

## How the vocabulary is learned

Saltmarsh learns its pieces from a training corpus with a merge loop:

1. Start from bytes. The text is read as raw bytes, so the starting vocabulary is the 256
   possible byte values. Any text at all can be written with them, so nothing is ever unknown.
2. Count every pair of neighbouring symbols across the whole corpus.
3. Take the most frequent pair, for example "t" followed by "h", and add it to the vocabulary as
   one new symbol, "th".
4. Replace that pair everywhere in the corpus with the new symbol, then count again.
5. Repeat until the vocabulary reaches its target size.

The order of the merges is part of the tokenizer. Early merges join very common pairs; late
merges build whole common words and word endings.

## How text is encoded

To encode new text, Saltmarsh first splits it into bytes, then replays the learned merges in the
order they were learned, joining every pair it can. A common word such as "the" collapses into
one token. An unusual word such as "glimmerwick" stays in several pieces, perhaps "gl", "immer"
and "wick", because no merge ever joined them.

## The trade-off

A larger vocabulary makes sequences shorter, because more text fits in each token, but every
entry needs its own row in the model's embedding table, and rare entries are seen too seldom
during training to be learned well. A smaller vocabulary is cheaper to store but makes every
sequence longer. On Saltmarsh's English test set, one token covers about 4 characters of text on
average; the guide warns that this ratio is a property of English prose, not of tokenizers.
