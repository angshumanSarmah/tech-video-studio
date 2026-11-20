# Post-incident report: checkout errors on 14 March 2025

_Invented post-incident report written for the Explainer Studio test fixtures. Larkspur Pay and
everything that happened to it are made up._

Published by the Larkspur Pay platform team, 21 March 2025.

## Summary

For 47 minutes, 31% of checkout requests failed. The rate limiter's shared store became slow,
the limiter fell back to local limits on each instance, and the payment provider behind checkout
received far more traffic than its contract allowed. The provider then throttled all of our
traffic.

## Timeline (UTC)

- 09:12 A routine failover moved the limiter's store to a replica in another zone. Store calls
  went from about 1 ms to 80 ms.
- 09:13 Calls over the 50 ms store timeout counted as failures. Our limiter is configured to
  fail open: on store failure each of the 40 checkout instances enforced the limit locally.
- 09:14 With 40 instances each allowing the full limit, traffic to the payment provider reached
  roughly 40 times our contracted rate of 300 requests per second.
- 09:16 The provider began answering 429 to most of our calls. Checkout errors rose to 31%.
- 09:59 The store moved back to its home zone; limits were shared again and errors stopped.

## Why fail open

We chose fail open for checkout deliberately: refusing payments because the limiter's store is
slow loses sales on every request. That reasoning held for our own servers, which have headroom,
but not for the downstream provider, whose limit is fixed by contract.

## What we changed

1. The limiter for calls to the payment provider now fails closed. A slow store delays some
   payments instead of breaking all of them.
2. Local fallback limits are divided by the number of instances, so 40 instances together stay
   within the contracted rate.
3. The store timeout for the checkout limiter rose from 50 ms to 150 ms, above a cross-zone
   round trip.

## Open item

We have not decided whether limits for our own APIs should fail open or closed. Teams disagree,
and the trade-off depends on what sits behind each route.
