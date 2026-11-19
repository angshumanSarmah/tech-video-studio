/**
 * Where each block of a `conveyor_queue` is, from its part state alone. A block's slot counts
 * the blocks ahead of it by their presence, so when one is taken (its presence falls) the ones
 * behind slide forward smoothly, and an arriving block (presence rising) slides in from the left.
 */

export type QueueItemInput = {
  /** 0..1: the block's presence (enter / exit). */
  presence: number;
  /** 0..1: progress of its `exit` (being taken); 0 when it has none or it is still ahead. */
  taken: number;
};

export type QueueGeometry = {
  /** Centre x of the front slot (the right end of the belt). */
  headX: number;
  /** Distance between neighbouring slots' centres. */
  pitch: number;
  /** Centre x where an arriving block starts. */
  entryX: number;
  /** How far a taken block lifts before it is gone. */
  liftPx: number;
};

export type QueuePlace = { x: number; lift: number; opacity: number };

export function queuePlaces(items: readonly QueueItemInput[], g: QueueGeometry): QueuePlace[] {
  let ahead = 0;
  return items.map((item) => {
    const slotX = g.headX - ahead * g.pitch;
    ahead += item.presence;
    if (item.taken > 0) return { x: slotX, lift: item.taken * g.liftPx, opacity: 1 - item.taken };
    return { x: g.entryX + (slotX - g.entryX) * item.presence, lift: 0, opacity: item.presence };
  });
}

/** How far the belt's treads have moved: one pitch for every block taken. */
export function treadShift(items: readonly QueueItemInput[], pitch: number): number {
  return items.reduce((sum, item) => sum + item.taken, 0) * pitch;
}
