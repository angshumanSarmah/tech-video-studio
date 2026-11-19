# Reference: database failover and split-brain (real incident)

- Use: structure study only. Never reuse the source's wording, look, assets or titles.
- Series: System Design · Topic class: internals · Length: about 50 s
- Format: card layout (a fixed title header for the whole video, a 16:9 diagram window in the
  middle, captions and a link badge to a longer video below). A short cut from a long video.

## Hook

The leader database dies one night; writes stop. The title header states the incident's paradox for
the whole video: a few seconds of glitch caused about a day of degradation.

## Structure

Concept (failover) → the hard question → real incident case study → consequence → new rule → two-line
takeaway → pointer to the long video.

## Beats

1. **Failover.** An app writes to a leader. The leader is crossed out; the app's writes fail. Three
   followers appear; a leader badge (crown) moves onto one follower, the others re-point to copy from
   it, and the app's write line re-routes to the new leader. A label names the concept.
2. **The hard question.** The diagram dims behind a two-line question card: is the old leader really
   dead?
3. **Real incident.** A dated, sourced case: two regional databases linked through a network hub. The
   link to the primary breaks (dashed line, ✗) while a timer tag counts the outage seconds. Automatic
   failover promotes the other region's replica.
4. **Split-brain.** The link returns; both databases now carry the leader badge, each with its own
   new writes. A warning tag says the sides diverged, then shows the degradation time and that
   writes were reconciled by hand.
5. **New rule.** A rule tag: no automatic promotion across regions.
6. **Takeaway.** The diagram dims behind a two-line contrast card: promoting a new leader is easy;
   proving the old one is gone is hard.

## Devices

Concept first, then real incident · the hard question as a dimmed-scene card · dated incident with a
source footnote · failure before rule · two-line contrast takeaway · persistent title header ·
pointer to a longer video.

## Patterns and primitives

failover (badge moves to a follower, links re-route) · split_brain (partition with a timer tag, two
leaders, divergent writes, conflict callout) · connector broken state + counter tag · node_card
(database) with a role badge · callout / tag for rules · statement card over the dimmed scene · source
footnote.

## Missing in our library

Card layout format (title header + diagram window + caption band) · statement_card · role badge
(crown) on nodes · source footnote on scenes · failover and split_brain patterns.
