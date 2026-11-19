import { z } from 'zod';
import { AssetIdSchema, lineText } from '../../primitives/common-props.ts';
import { ROLE_PART } from '../../primitives/node-card/definition.ts';
import { TIMER_MAX_SEC } from '../../primitives/timer-ring/definition.ts';
import { el, link, nodeParam, nodeProps, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'steady', description: 'The leader replicates to the far replica over the link.' },
  {
    name: 'partition',
    description: 'The link between the regions breaks; the outage clock starts.',
  },
  { name: 'promote', description: 'The far replica, cut off, takes the role badge too.' },
  { name: 'writes', description: 'Each side accepts a different write.' },
  { name: 'heal', description: 'The link returns: the clock stops and the conflict shows.' },
] as const;

export const splitBrainPattern = definePattern({
  id: 'split_brain',
  family: 'flow',
  layoutMode: 'versus_split',
  paramsSchema: z.strictObject({
    leader: nodeParam('The leader in the first region.'),
    replica: nodeParam('The replica in the far region that promotes itself.'),
    role: AssetIdSchema.default('crown').describe('Asset id of the role badge (a crown).'),
    outage: z
      .strictObject({
        sec: z
          .number()
          .int()
          .min(1)
          .describe('How long the partition lasted; the clock counts up to it while it lasts.'),
        unit: lineText(16, 'Unit after the number.').default('s'),
        label: lineText(32, 'Caption under the clock.').default('PARTITION'),
      })
      .describe('The outage clock: counts up from the partition and stops on the heal.'),
    lease: z
      .strictObject({
        durationSec: z
          .number()
          .int()
          .min(1)
          .max(TIMER_MAX_SEC)
          .describe('Lease length in seconds.'),
        label: lineText(24, 'Caption under the lease timer.').default('LEASE'),
      })
      .optional()
      .describe('Optional lease timer that runs out when the replica promotes itself.'),
    writes: z
      .strictObject({
        leader: lineText(24, 'The write the leader accepts, e.g. ROW 7 → v2.'),
        replica: lineText(24, 'The conflicting write the replica accepts.'),
      })
      .describe('The divergent writes, one per side.'),
    conflict: lineText(64, 'The conflict, stated plainly, e.g. Two owners for one record.'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full', 'card'],
  formatRule: { when: 'the lease timer', formats: ['full'], applies: (p) => p.lease !== undefined },
  anchors: ANCHORS,
  targets: [
    { id: 'leader', description: 'The leader.' },
    { id: 'replica', description: 'The far replica.' },
    { id: 'link', description: 'The replication link (rejected on partition).' },
    { id: 'cut', description: 'The dashed, broken link during the partition.' },
    { id: 'restored', description: 'The link after the heal.' },
    { id: 'outage', description: 'The outage clock (counts up, red when it stops).' },
    { id: 'lease', description: 'The optional lease timer.' },
    { id: 'leader-write', description: "The leader's write." },
    { id: 'replica-write', description: "The replica's write." },
    { id: 'conflict', description: 'The conflict callout.' },
  ],
  description: {
    summary:
      'Two regions with a leader and a replica. The link breaks (red, then dashed) and an outage ' +
      'clock counts up; cut off, the replica takes the role badge too. Each side accepts a ' +
      'different write. When the link returns the clock stops, both nodes hold the badge and a ' +
      'conflict callout names the damage.',
    whenToUse:
      'Network partitions and split brain: two primaries after a partition, fencing and leases, ' +
      'why quorums exist; the real-incident beat after a `failover` concept beat.',
    whenNotToUse:
      'A clean failover where the old leader is really gone (use `failover`); a single request ' +
      'refused under a lock (use `atomic_lock`).',
  },
  example: {
    params: {
      leader: { title: '<example-leader>', icon: 'database' },
      replica: { title: '<example-replica>', icon: 'database' },
      outage: { sec: 43 },
      lease: { durationSec: 10 },
      writes: { leader: '<example-write-a>', replica: '<example-write-b>' },
      conflict: '<example-conflict>',
      at: {
        steady: { type: 'word', index: 0 },
        partition: { type: 'word', index: 1 },
        promote: { type: 'word', index: 2 },
        writes: { type: 'word', index: 3 },
        heal: { type: 'word', index: 4 },
      },
    },
  },
  expand: (p) => {
    // The replica's badge first appears with `enter`, so it starts hidden (node_card role part).
    const role = [ROLE_PART];
    const lease = p.lease;
    return {
      elements: [
        el('leader', 'node_card', nodeProps(p.leader, { role: p.role }), 'left'),
        el('replica', 'node_card', nodeProps(p.replica, { role: p.role }), 'right'),
        link('link', 'leader', 'replica', { heads: 'both' }),
        link('cut', 'leader', 'replica', { heads: 'none', dashed: true, semantic: 'problem' }),
        link('restored', 'leader', 'replica', { heads: 'both' }),
        el(
          'outage',
          'counter',
          {
            value: p.outage.sec,
            from: 0,
            unit: p.outage.unit,
            label: p.outage.label,
            semantic: 'problem',
            ticking: true,
          },
          'shared',
        ),
        ...(lease
          ? [
              el(
                'lease',
                'timer_ring',
                { durationSec: lease.durationSec, label: lease.label },
                'shared',
              ),
            ]
          : []),
        el('leader-write', 'tag', { text: p.writes.leader, semantic: 'concept' }, 'left'),
        el('replica-write', 'tag', { text: p.writes.replica, semantic: 'focus' }, 'right'),
        el(
          'conflict',
          'callout',
          { title: 'CONFLICT', text: p.conflict, semantic: 'problem' },
          'shared',
        ),
      ],
      events: [
        on(p.at.steady, 'enter', ['leader', 'replica', 'link']),
        on(p.at.steady, 'move', ['link']),
        on(p.at.partition, 'reject', ['link']),
        on(p.at.partition, 'enter', ['cut', 'outage']),
        on(p.at.partition, 'count', ['outage']),
        ...(lease
          ? [on(p.at.partition, 'enter', ['lease']), on(p.at.partition, 'count', ['lease'])]
          : []),
        on(p.at.promote, 'exit', ['link']),
        on(p.at.promote, 'enter', ['replica'], role),
        on(p.at.promote, 'pulse', ['replica']),
        ...(lease ? [on(p.at.promote, 'reject', ['lease'])] : []),
        on(p.at.writes, 'enter', ['leader-write', 'replica-write']),
        on(p.at.heal, 'exit', ['cut']),
        on(p.at.heal, 'enter', ['restored', 'conflict']),
        on(p.at.heal, 'reject', ['outage']),
        on(p.at.heal, 'pulse', ['leader', 'replica']),
      ],
    };
  },
});
