# glyphcut

_Invented README written for the Explainer Studio test fixtures. glyphcut is not a real
library._

glyphcut is a small library for byte-level subword tokenizers. It loads a vocabulary and a merge
list, and turns text into token ids and back.

```text
tok = glyphcut.load("vocab.json", "merges.txt")
ids = tok.encode("Hello there")
text = tok.decode(ids)
```

## Guarantees

- **Round trip.** `decode(encode(text))` returns exactly the original text, including spaces,
  line breaks and emoji. glyphcut works on bytes, so it never needs an "unknown" token.
- **Deterministic.** The same text and the same vocabulary always give the same ids.

## Pre-tokenization

Before any merge runs, glyphcut splits text into chunks, and merges never cross a chunk border:

- Letters stay together; punctuation is split off from them.
- A space is kept at the start of the word that follows it, so " cat" (with its space) and "cat"
  (at the start of a line) are two different tokens with two different ids.
- Digits are split one at a time, so a long number becomes one token per digit. This keeps the
  vocabulary from spending entries on arbitrary numbers.

## Special tokens

Some ids are reserved and never come from text: `<|start|>` marks the beginning of a document,
`<|end|>` its end, and `<|pad|>` fills unused positions in a batch. They are added by the
application, never produced by `encode` from ordinary text, so a user cannot type them.

## Counting tokens

`tok.count(text)` returns the number of tokens without building the list. Use it, not a word
count, when you need to know whether a prompt fits a context window or what a request will cost:
the two can differ a lot, and only the tokenizer that the model was trained with gives the true
number.

## Known limits

- A different vocabulary gives different ids. Ids from one model's tokenizer mean nothing to
  another model.
- Capital letters, leading spaces and rare spellings change how a word splits, so "Paris",
  " Paris" and "PARIS" can be one, one and three tokens.
