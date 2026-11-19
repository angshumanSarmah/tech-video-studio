# Reference: ride-hailing live demand heat map

- Use: structure study only. Never reuse the source's wording, look, assets or titles.
- Series: System Design · Topic class: product-design · Length: about 1:45

## Hook

A crowd event creates sudden demand in one spot while supply is scattered far away. A rising
booking counter and small "searching" bubbles over the crowd, then a top-down map with one pulsing
demand point and a few distant cars. Problem: build a live demand map that survives the spike.

## Structure

Hook → 5 numbered steps → 2 named traps (inside step 3) → scaling → callback ending with a joke.

## Beats

1. **Location pings.** A moving car's phone emits a small data block (driver id, position, time).
   Packets pile up on one server until it shows overload, then line up on a queue belt.
2. **Grid cells.** A grid is dropped over the map; one car is focused and its coordinates morph
   into a cell id.
3. **Counters.** The map becomes a grid of numbers. A car crosses a cell boundary: the old cell
   decrements (red), the new one increments (green).
4. **Trap 1: standing still.** A stopped car keeps sending pings and its count climbs wrongly.
   Fix: remember each driver's last cell and update only on change.
5. **Trap 2: going offline.** A car loses signal; a countdown ring runs out and its count expires.
6. **Heat map.** The number grid is coloured by density.
7. **Scaling.** Several small maps, each wired to its own server (sharding by region). Then a
   versus split: square cells have unequal neighbour distances, hexagons have equal ones.
8. **Ending.** One overloaded cell triggers a price surge on a generic app card, then a failed
   search state as the punchline.

## Devices

Crowd hook · object-to-data morph · failure before fix · named traps · versus split · local flavour
in the punchline · callback ending.

## Patterns and primitives

flood_then_funnel · conveyor_queue · packet_stream · data_block · map_base + grid_overlay with a cell
highlight · counter_transition per cell · timer_ring (expiry) · heat colouring of a number grid ·
versus_split · sharding (several maps, each to a server) · device_frame (price card, failed state).

## Missing in our library

Hex grid with an equidistance overlay · traffic light and offline-signal props · 3D crowd scene
(phase 2).
