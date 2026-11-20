# A field guide to token-bucket rate limiting

_Invented article written for the Explainer Studio test fixtures. The service, numbers and
names below are made up._

## What the limiter decides

A rate limiter answers one question per request: may this caller do this now? The token bucket
answers it with two numbers per key. The bucket holds at most a fixed number of tokens (its
capacity), and tokens drip back in at a fixed refill rate. Each request takes one token. When
the bucket is empty, the request is refused with HTTP 429 Too Many Requests and a Retry-After
header that says how many seconds until the next token arrives.

At Hollowmere, the invented API gateway this guide follows, a free-tier key gets a capacity of
100 tokens and a refill rate of 10 tokens per second. A client that has been quiet can burst 100
requests at once, then settles to 10 requests per second.

## Step by step

1. The gateway builds the key from the API key and the route group, for example
   `key:7781:search`.
2. It reads two fields for that key from the shared store: the token count and the timestamp of
   the last refill.
3. It adds the tokens earned since that timestamp (elapsed seconds times the refill rate),
   capped at the capacity.
4. If at least one token is left, it takes one, writes the new count and timestamp back, and
   lets the request through.
5. Otherwise it answers 429 and computes Retry-After from the refill rate.

Steps 2 to 4 run as one atomic script inside the store. Without that, two gateway nodes can
read the same count, both see one token left, and both let a request through.

## Why a shared store

Hollowmere runs 24 gateway nodes behind a load balancer. If each node kept its own bucket, a
client spread across all of them would get 24 times its limit. Keeping the bucket in one shared
in-memory store costs a network round trip on every request: 0.4 ms at the median and 2.1 ms at
p99 in their measurements from June 2024.

## Why not a fixed window

The first version counted requests per calendar minute and reset the counter at the top of each
minute. It was cheap, one counter per key, but a client could send its whole quota in the last
second of one minute and again in the first second of the next: up to 2 times the limit inside
two seconds. The token bucket was chosen because it bounds bursts by the capacity no matter
where the clock is.

## A common misreading

Engineers often assume a rate limiter protects a service from a flood of traffic. It protects
fairness between well-behaved clients. A real flood of 2 million requests per second still
reaches the gateways, which must parse every request and look up its key before they can refuse
it. Dropping that traffic is the job of the network edge, not of the limiter.
