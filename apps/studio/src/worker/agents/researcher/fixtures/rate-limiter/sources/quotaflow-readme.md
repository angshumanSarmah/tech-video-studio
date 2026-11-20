# quotaflow

_Invented README written for the Explainer Studio test fixtures. quotaflow is not a real
library._

quotaflow is a rate-limiting library for HTTP services. It ships three algorithms behind one
interface and keeps its state in a shared store, so every instance of a service enforces the
same limit.

> quotaflow is the fastest and most accurate rate limiter available, with accuracy within 0.5%
> of an ideal limiter under any load.

## Algorithms

| algorithm              | state per key           | burst behaviour    |
| ---------------------- | ----------------------- | ------------------ |
| token bucket           | 2 fields                | up to the capacity |
| sliding window log     | 1 timestamp per request | none               |
| sliding window counter | 2 counters              | small, see below   |

The sliding window log stores the timestamp of every request in the window and counts them. It
is exact, but memory grows with the limit: at 8 bytes per timestamp, a limit of 1,000 requests
per minute costs about 8 KB per active key. With 500,000 active keys that is around 4 GB.

The sliding window counter keeps only the current and previous window's counts and weights the
previous one by how much of it still overlaps the sliding window. It needs 2 counters per key
and is approximate: it assumes requests in the previous window were evenly spread.

## Defaults

- Algorithm: token bucket.
- Store timeout: 50 ms. A store call slower than that counts as a store failure.
- On store failure: fail closed. quotaflow refuses the request with 503 rather than serving
  traffic it cannot count. We recommend keeping this default for every route.
- Local fallback: off. When enabled, each instance enforces the limit on its own while the store
  is down, which multiplies the effective limit by the number of instances.

## Configuration

```yaml
limits:
  - match: { route: /search }
    algorithm: token_bucket
    capacity: 100
    refill_per_sec: 10
```

## Known limits

Clock skew between instances does not affect quotaflow, because timestamps are taken inside the
store. Keys are not expired until 2 windows after their last request, so memory for idle keys
lingers briefly.
