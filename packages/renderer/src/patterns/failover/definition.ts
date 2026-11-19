import { z } from 'zod';
import { AssetIdSchema } from '../../primitives/common-props.ts';
import { ROLE_PART } from '../../primitives/node-card/definition.ts';
import { el, link, nodeParam, nodeProps, nth, numbered, on } from '../build.ts';
import { anchorsSchema, definePattern } from '../types.ts';

const ANCHORS = [
  { name: 'steady', description: 'Writes reach the leader and replicate to the followers.' },
  { name: 'fail', description: 'The leader fails and its links break.' },
  { name: 'promote', description: 'The role moves from the old leader to the first follower.' },
  { name: 'reroute', description: 'The writer and the other followers link to the new leader.' },
] as const;

export const failoverPattern = definePattern({
  id: 'failover',
  family: 'flow',
  layoutMode: 'pipeline',
  paramsSchema: z.strictObject({
    writer: nodeParam('Who writes (an app server, a client).'),
    leader: nodeParam('The leader that fails.'),
    followers: z
      .array(nodeParam('One follower (replica).'))
      .min(1)
      .max(3)
      .describe('The followers, 1 to 3; the first one is promoted.'),
    role: AssetIdSchema.default('crown').describe('Asset id of the role badge (a crown).'),
    at: anchorsSchema(ANCHORS),
  }),
  actions: ['exit', 'highlight', 'dim', 'pulse'],
  formats: ['full', 'card'],
  anchors: ANCHORS,
  targets: [
    { id: 'writer', description: 'The writer.' },
    { id: 'leader', description: 'The old leader.' },
    { id: 'follower-<n>', description: 'The n-th follower (from 1); follower-1 is promoted.' },
    { id: 'write', description: 'Arrow from the writer to the old leader.' },
    { id: 'repl-<n>', description: 'Replication arrow from the old leader to the n-th follower.' },
    { id: 'new-write', description: 'Arrow from the writer to the new leader.' },
    {
      id: 'new-repl-<n>',
      description: 'Replication arrow from the new leader to the n-th follower.',
    },
  ],
  description: {
    summary:
      'A writer, a leader with the role badge and its followers. The leader fails: it turns red ' +
      'and its links break. The badge leaves the old leader and appears on the first follower, ' +
      'then the writer and the other followers re-link to the new leader.',
    whenToUse:
      'Leader election and failover: a database primary dying, a broker partition leader moving, ' +
      'a lock holder replaced. The concept beat before a real incident.',
    whenNotToUse:
      'Both sides believing they lead after a network split (use `split_brain`); one request ' +
      'refused while a lock is held (use `atomic_lock`).',
  },
  example: {
    params: {
      writer: { title: '<example-writer>', icon: 'server' },
      leader: { title: '<example-leader>', icon: 'database' },
      followers: [
        { title: '<example-follower-1>', icon: 'database' },
        { title: '<example-follower-2>', icon: 'database' },
      ],
      at: {
        steady: { type: 'word', index: 0 },
        fail: { type: 'word', index: 1 },
        promote: { type: 'word', index: 2 },
        reroute: { type: 'word', index: 3 },
      },
    },
  },
  expand: (p) => {
    const followers = numbered('follower', p.followers.length);
    const repls = numbered('repl', p.followers.length);
    const others = followers.slice(1);
    const newRepls = others.map((_, i) => nth('new-repl', i + 1));
    const role = [ROLE_PART];
    return {
      elements: [
        el('writer', 'node_card', nodeProps(p.writer), 'source'),
        el('leader', 'node_card', nodeProps(p.leader, { role: p.role }), 'sink'),
        ...p.followers.map((f, i) =>
          el(
            nth('follower', i),
            'node_card',
            nodeProps(f, i === 0 ? { role: p.role } : {}),
            'sink',
          ),
        ),
        link('write', 'writer', 'leader'),
        ...followers.map((f, i) => link(nth('repl', i), 'leader', f, { dashed: true })),
        link('new-write', 'writer', 'follower-1', { semantic: 'ok' }),
        ...others.map((f, i) =>
          link(nth('new-repl', i + 1), 'follower-1', f, { dashed: true, semantic: 'ok' }),
        ),
      ],
      events: [
        on(p.at.steady, 'enter', ['writer', 'leader', ...followers, 'write', ...repls]),
        on(p.at.steady, 'move', ['write', ...repls]),
        on(p.at.fail, 'reject', ['leader', 'write', ...repls]),
        on(p.at.promote, 'exit', ['leader'], role),
        on(p.at.promote, 'enter', ['follower-1'], role),
        on(p.at.promote, 'pulse', ['follower-1']),
        on(p.at.reroute, 'exit', ['write', ...repls]),
        on(p.at.reroute, 'enter', ['new-write', ...newRepls]),
        on(p.at.reroute, 'move', ['new-write', ...newRepls]),
      ],
    };
  },
});
