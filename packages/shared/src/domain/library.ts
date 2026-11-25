import { z } from 'zod';

/**
 * Where a topic source comes from: a URL, an uploaded file, or text pasted with a title (stored
 * as a file and read like an uploaded `.txt`).
 */
export const SOURCE_KINDS = ['url', 'file', 'text'] as const;
export const SourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SOURCE_STATUSES = ['pending', 'extracted', 'failed'] as const;
export const SourceStatusSchema = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

/** Assets enter the library only after user approval. */
export const ASSET_STATUSES = ['draft', 'approved', 'rejected'] as const;
export const AssetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

/**
 * Which agents a style rule is injected into: one agent, or `all` (the three writers: the
 * Director, the Scriptwriter and the Generator; never the Curator, P1C.10).
 */
export const MEMORY_RULE_SCOPES = [
  'director',
  'scriptwriter',
  'generator',
  'curator',
  'all',
] as const;
export const MemoryRuleScopeSchema = z.enum(MEMORY_RULE_SCOPES);
export type MemoryRuleScope = z.infer<typeof MemoryRuleScopeSchema>;

/** Rules are stored as proposed and become active only after the user accepts them. */
export const MEMORY_RULE_STATUSES = ['proposed', 'active', 'inactive', 'rejected'] as const;
export const MemoryRuleStatusSchema = z.enum(MEMORY_RULE_STATUSES);
export type MemoryRuleStatus = z.infer<typeof MemoryRuleStatusSchema>;

/** What a usage-history row records, one value per row. */
export const USAGE_KINDS = [
  'device',
  'layout',
  'pattern',
  'primitive',
  'metaphor_world',
  'topic_class',
  /** A beat's narrative device with its layout mode, as `<device>/<layout>` (variety penalty). */
  'device_layout',
  /** The video's hook: `<hook kind>/<device of its hook beat>` (`hookKey`). */
  'hook',
  /** `story.ending.kind`. Recorded for the usage history, never checked (the house ending repeats). */
  'ending',
  /** Its first few distinct patterns in board order, `a>b>c` (`mainPatternSequence`). */
  'pattern_sequence',
  /** A reference video its Director was shown (the slug; P1C.11): picks rotate across videos. */
  'reference',
] as const;
export const UsageKindSchema = z.enum(USAGE_KINDS);
export type UsageKind = z.infer<typeof UsageKindSchema>;

export const BACKLOG_STATUSES = ['open', 'planned', 'built', 'rejected'] as const;
export const BacklogStatusSchema = z.enum(BACKLOG_STATUSES);
export type BacklogStatus = z.infer<typeof BacklogStatusSchema>;

/**
 * A reference video's record (P1C.11): waiting for the Reference analyst, ready (checked; the
 * Director may be shown it), or failed (the analyst's answer never passed the checks).
 */
export const REFERENCE_STATUSES = ['pending', 'ready', 'failed'] as const;
export const ReferenceStatusSchema = z.enum(REFERENCE_STATUSES);
export type ReferenceStatus = z.infer<typeof ReferenceStatusSchema>;

/** Where a reference came from: a committed seed breakdown, or one pasted through the API or CLI. */
export const REFERENCE_ORIGINS = ['seed', 'pasted'] as const;
export const ReferenceOriginSchema = z.enum(REFERENCE_ORIGINS);
export type ReferenceOrigin = z.infer<typeof ReferenceOriginSchema>;
