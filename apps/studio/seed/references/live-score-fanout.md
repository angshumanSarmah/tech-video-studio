# Reference: one live sports event to millions of phones

- Use: structure study only. Never reuse the source's wording, look, assets or titles.
- Series: System Design · Topic class: product-design

## Hook

A relatable persona secretly checks a live score at work. Planted question: where does this data
actually come from? It is paid off at the end.

## Structure

Hook with a planted question → 6 steps → payoff → callback ending + share line.

## Beats

1. **The event as data.** A real-world moment morphs into a data block that expands into fields
   (sequence id, value, actors, a commentary line).
2. **Write API and database.** The block arrives at a write API. A second block with the same id is
   stamped as a duplicate (idempotency). The accepted one goes to a database, then onto a queue.
3. **Workers.** Workers beside the queue: one builds a summary panel stored in a cache; another
   sends one notification that splits to two push services and fans out to a crowd of phones.
4. **Real load.** Many phones flood one central server, which shakes. A CDN appears in between and
   collapses all requests into one line to the origin (short cache). Push connections are mentioned
   as the costly alternative.
5. **Payoff.** The data starts with a person typing it in, answering the planted question.
6. **Ending.** Callback to the persona with a gag, then a share line.

## Devices

Persona hook · planted question with late payoff · object-to-data morph · reject duplicate · failure
before fix · fan-out to a crowd · callback ending.

## Patterns and primitives

reject_duplicate · conveyor_queue + worker_pool · fan_out · flood_then_funnel · data_block ·
stat_card (summary panel) · node_card (database, cache, servers).

## Missing in our library

Stamp effect · characters and gag props (phase 2) · picture-in-picture clip into a phone (phase 2).
