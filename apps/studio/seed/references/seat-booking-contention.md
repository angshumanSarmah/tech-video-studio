# Reference: who gets the last seat?

- Use: structure study only. Never reuse the source's wording, look, assets or titles.
- Series: System Design · Topic class: product-design

## Hook

One seat, several contenders at once (several booking apps and a box-office counter) all reaching
for it. A sourced stat card shows peak booking volume. Question: who gets the seat?

## Structure

Hook → roadmap of 7 steps shown up front → 7 steps with a step tracker → zoom out over the whole
architecture.

## Beats

1. **Opening the app.** Requests shown as moving objects on roads go to a nearby CDN and a cache.
2. **Gateway.** Requests pass a single entry point that checks login.
3. **Search index.** Search reads a separate index refreshed every few minutes. A seat panel flips
   from available to full: the stale-view bug viewers have seen.
4. **Ownership twist.** The venue's own system is the source of truth. Several venues with
   different APIs feed an aggregator that outputs one format.
5. **Atomic reserve.** A tap locks the seat with a hold timer; a second request moments later is
   rejected.
6. **Payment: two clocks.** An app timer and a venue hold timer run side by side; the hold expires
   just as a late payment succeeds, so it is refunded.
7. **Queue and workers.** A queue feeds workers that produce a message, a QR code and a ticket. A
   person scans the code at the gate and the record matches.
8. **Ending.** Zoom out over everything built step by step, then a follow line.

## Devices

Contention hook · sourced stat card · roadmap + step tracker · "you've seen this bug" · ownership
twist · race reveal (two clocks) · real-world closure · persistent world with a final zoom-out.

## Patterns and primitives

Persistent scene where each step adds a part and non-focus parts dim · converge_adapter ·
atomic_lock · two timer_rings with an event landing in the gap · stale view · conveyor_queue +
worker_pool · callout labels pinned to objects (bold title + small subtitle).

## Missing in our library

3D isometric world with roads and a final zoom-out (phase 2) · characters at a turnstile (phase 2) ·
venue seat-map world kit.
