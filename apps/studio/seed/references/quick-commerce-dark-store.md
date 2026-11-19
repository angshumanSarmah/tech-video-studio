# Reference: delivering an order in minutes

- Use: structure study only. Never reuse the source's wording, look, assets or titles.
- Series: System Design · Topic class: product-design
- Described from screenshots; the ending is unknown.

## Hook

A delivery rider leaves a warehouse. A hero metric (item + delivery minutes) stays pinned at the top
and a story clock (order → doorbell) runs at the bottom for the whole video. A route draws from the
store to the customer.

## Structure

Hook with hero metric and story clock → three questions listed up front → one chapter per question,
the question shown as the chapter header: where does the item come from, is it in stock, how is it
so fast?

## Beats

1. **Dark store.** A route with a distance tag from a nearby warehouse to the customer; the
   warehouse is revealed as online-orders-only.
2. **Service area.** A polygon marks each store's delivery area; outside it, no delivery.
3. **Brute force first.** Many overlapping store areas; checking each one in turn is shown as slow.
4. **Grid lookup.** A grid is dropped over the map; only the customer's cell and the few areas
   overlapping it light up (spatial index).
5. **Stock.** An inventory card of identical units; payment succeeds, one unit is locked to this
   order, a second order is rejected, and the stock counter drops by one.
6. **Speed.** A segmented time bar splits the budget between packing and riding. Shelf slots with
   item icons; one lights up and a picker moves straight to it (fixed locations).

## Devices

Hero metric + story clock · question-driven chapters listed up front · brute force before the fix ·
atomic reservation on one unit · 3D establishing shot, then flat 2D boards.

## Patterns and primitives

route_path with distance tag and pins · zone_polygon (areas, overlap, outside = problem) ·
grid_overlay with the customer's cell (brute_force_then_index) · slot_grid · atomic_lock + reject +
counter_transition · segmented_time_bar · item_icon set of everyday objects · tag.

## Missing in our library

3D warehouse and rider scene (phase 2) · transition from a 2D map into a 3D interior.
