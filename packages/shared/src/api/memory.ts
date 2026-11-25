import { z } from 'zod';
import {
  MemoryRuleScopeSchema,
  MemoryRuleStatusSchema,
  UsageKindSchema,
} from '../domain/library.ts';
import { GateIdSchema } from '../domain/run.ts';
import { RuleTextSchema } from '../memory/rules.ts';
import { listOf } from './common.ts';

/** Videos `GET /api/memory/usage` covers when the query names none, and at most. */
export const DEFAULT_USAGE_VIDEOS = 10;
export const MAX_USAGE_VIDEOS = 50;

/** `GET /api/memory/usage?videos=N`: the last N exported videos. */
export const UsageQuerySchema = z.object({
  videos: z.coerce.number().int().min(1).max(MAX_USAGE_VIDEOS).default(DEFAULT_USAGE_VIDEOS),
});

/** One exported video: a single run, or a multi-part video's parts together. */
export const UsageVideoSchema = z.strictObject({
  /** The video's run: the parent of a multi-part video, else the run itself. */
  videoRunId: z.number().int().positive(),
  /** The runs that exported it (each part), in export order. */
  runIds: z.array(z.number().int().positive()),
  /** The newest export's title. */
  title: z.string().nullable(),
  /** When its newest part exported (ISO). */
  exportedAt: z.iso.datetime(),
  hooks: z.array(z.string()),
  endings: z.array(z.string()),
  sequences: z.array(z.string()),
});
export type UsageVideo = z.infer<typeof UsageVideoSchema>;

/** A value and how many of the videos used it. */
export const UsageCountSchema = z.strictObject({
  value: z.string(),
  videos: z.number().int().positive(),
});
export type UsageCount = z.infer<typeof UsageCountSchema>;

/** The usage history over the last videos (P1C.10; the Memory page's charts, P1D.8). */
export const UsageSummarySchema = z.strictObject({
  /** Newest first. */
  videos: z.array(UsageVideoSchema),
  /** Per kind, each value with the number of videos that used it: most used first, then by value. */
  counts: z.record(UsageKindSchema, z.array(UsageCountSchema)),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** A style rule (P1C.10): proposed by the Analyst (or added by hand), applied once active. */
export const MemoryRuleDtoSchema = z.object({
  id: z.number().int().positive(),
  scope: MemoryRuleScopeSchema,
  text: z.string(),
  status: MemoryRuleStatusSchema,
  /** The gate note it was proposed from, and the Analyst's one-line reason. */
  note: z.string().nullable(),
  reason: z.string().nullable(),
  sourceRunId: z.number().int().nullable(),
  sourceGate: GateIdSchema.nullable(),
  /** The gate decision event it was proposed from. */
  sourceEventId: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MemoryRuleDto = z.infer<typeof MemoryRuleDtoSchema>;

export const MemoryRuleListResponseSchema = listOf(MemoryRuleDtoSchema);
export type MemoryRuleListResponse = z.infer<typeof MemoryRuleListResponseSchema>;

/** `GET /api/memory/rules?status&scope`: oldest first. */
export const MemoryRuleQuerySchema = z.object({
  status: MemoryRuleStatusSchema.optional(),
  scope: MemoryRuleScopeSchema.optional(),
});

/** `POST /api/memory/rules`: a rule written by hand, active at once (within the cap). */
export const CreateMemoryRuleRequestSchema = z.strictObject({
  scope: MemoryRuleScopeSchema,
  text: RuleTextSchema,
});
export type CreateMemoryRuleRequest = z.input<typeof CreateMemoryRuleRequestSchema>;

/**
 * What a rule's next status is: `accept` (proposed → active), `reject` (proposed → rejected),
 * `activate` (inactive → active), `deactivate` (active → inactive).
 */
export const MEMORY_RULE_ACTIONS = ['accept', 'reject', 'activate', 'deactivate'] as const;
export const MemoryRuleActionSchema = z.enum(MEMORY_RULE_ACTIONS);
export type MemoryRuleAction = z.infer<typeof MemoryRuleActionSchema>;

/**
 * `PATCH /api/memory/rules/:id`: an action, a new text or scope, or both (accept with an edited
 * text). A rule that would become active past `MAX_RULES_PER_AGENT` for an agent is a 409.
 */
export const UpdateMemoryRuleRequestSchema = z
  .strictObject({
    action: MemoryRuleActionSchema.optional(),
    text: RuleTextSchema.optional(),
    scope: MemoryRuleScopeSchema.optional(),
  })
  .refine((r) => r.action !== undefined || r.text !== undefined || r.scope !== undefined, {
    message: 'Give an action, a text or a scope.',
  });
export type UpdateMemoryRuleRequest = z.input<typeof UpdateMemoryRuleRequestSchema>;

/** `POST /api/memory/rules/propose`: the Analyst reads one gate decision's note. */
export const ProposeRuleRequestSchema = z.strictObject({
  eventId: z.number().int().positive(),
});
export type ProposeRuleRequest = z.input<typeof ProposeRuleRequestSchema>;

/** The queued `propose_rule` job (it belongs to no run); follow it on `GET /api/events?jobId=`. */
export const ProposeRuleResponseSchema = z.object({ jobId: z.number().int().positive() });
export type ProposeRuleResponse = z.infer<typeof ProposeRuleResponseSchema>;
