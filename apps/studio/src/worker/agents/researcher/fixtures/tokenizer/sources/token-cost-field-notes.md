# Field notes: counting tokens before you pay for them

_Invented engineering blog post written for the Explainer Studio test fixtures. Corrowby and its
product are not real._

At Corrowby, an invented support-chat company, every request to our language model is billed by
the token, and every conversation has to fit in the model's context window, also measured in
tokens. For a year we estimated both from word counts. These notes are what we learned when we
started counting tokens properly.

## Words are not tokens

Our first surprise was how loose the link between words and tokens is. For our English support
replies, one word came to about 1.3 tokens on average: short common words are one token each,
while product names, long words and anything with unusual capitals split into several.

## The same meaning, a different bill

The second surprise was language. We sent the same set of support answers, translated, through
the same tokenizer. Languages that were common in the tokenizer's training text came out close
to English. A language that was rare in that training text needed about 3 times as many tokens
to say the same thing, because its words had few merges of their own and were spelled out in
small pieces. The same answer cost three times as much and used three times as much of the
context window.

## Code and numbers

Source code surprised us in a smaller way. Runs of spaces used for indentation, and identifiers
written in mixed case, split into many tokens. Numbers were split digit by digit, so an order
number is as many tokens as it has digits. We believe this is also why the model sometimes slips
on long arithmetic: it never sees a number as one thing, only as a row of digits.

## What we changed

- We count tokens with the exact tokenizer of the model we call, never with word counts or
  another model's tokenizer.
- Budgets for prompts and replies are written in tokens.
- Per-language cost reports, so a support team writing in a rare language is not surprised.

## What we still argue about

The often-quoted rule that a token is "about four characters" held for our English text, but
not for code or for the rarer languages, and we have not agreed on a single rule to replace it.
Some of us want a per-language table; others want to count every message exactly and drop rules
of thumb altogether.
