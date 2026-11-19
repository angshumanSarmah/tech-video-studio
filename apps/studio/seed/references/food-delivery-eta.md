# Reference: how a food order arrives in minutes

- Use: structure study only. Never reuse the source's wording, look, assets or titles.
- Series: System Design + AI · Topic class: product-design (with an ML step)

## Hook

A surprisingly fast delivery of a large order, then a quick flashback to why the viewer ordered.
Claim: it isn't luck. The moment the order is placed, a model predicts preparation time and a rider
is assigned immediately.

## Structure

Hook → 5 steps on one persistent architecture → callback ending with a comment/share line. Each
deep dive opens as a detail card over the dimmed architecture.

## Beats

1. **Order service and database.** An order tag drops from the order service into a database and is
   confirmed as saved. An always-open connection pushes the new order to the restaurant's tablet
   within seconds; its button flips from accept to accepted.
2. **Prep-time model.** A detail card zooms in: feature rows (restaurant, item, quantity, time of
   day, kitchen load), grouped by a bracket, feed a model icon; the prediction flips from unknown to
   a few minutes. A comparison row shows a dish cooked fresh getting a much longer prediction.
3. **Rider matching.** A detail card with a map: the restaurant in the centre, riders inside a dashed
   search radius. The nearest rider is tagged and crossed out; a rider whose ETA matches the prep
   time is ringed instead. A warning box shows the counterfactual: assigning too early wastes the
   rider's time at the counter.
4. **ETA as a sum.** A segmented bar builds the displayed ETA: kitchen time (the rider travels during
   it) + ride + a small buffer = total.
5. **Live tracking.** Raw location points make the bike icon jump; then the app draws a smooth curve
   through them and the bike glides to the house.
6. **Ending.** Callback to the opening scene, with follow, comment and share prompts.

## Devices

Surprising-number hook · flashback · detail card over a dimmed system · inputs → model → prediction ·
obvious choice rejected, right one picked · counterfactual box · sum bar reveal · jumpy → smooth ·
callback ending.

## Patterns and primitives

Persistent architecture with non-focus parts dimmed · inset_panel · inference_card (data_block +
bracket + model node + counter_transition from "?") · pick_by_rule inside a radius_ring · callout ·
segmented_time_bar with a total · route_path jumpy → smooth with a mover · device_frame (tablet with
an accept button) · tag (status tags above nodes) · connector with packets.

## Missing in our library

Covered by P1A.7b and P1A.8. Not to be built: illustrated character scenes (that style is the source
creator's signature).
