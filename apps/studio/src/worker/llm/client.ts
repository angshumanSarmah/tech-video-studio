import { randomBytes } from 'node:crypto';
import {
  toJsonPath,
  type LlmSettings,
  type LogLevel,
  type ModelRole,
  type NormalizerFix,
} from '@explainer-studio/shared';
import type { z } from 'zod';
import { llmCallPaths, writeDataJson } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { insertLlmCall, type LlmCallRow } from '#core/db/repositories/llm-calls.ts';
import { callCostUsd } from './cost.ts';
import { normalizeJsonText, type FieldAlias } from './normalize.ts';
import { LlmConfigError } from './transport.ts';
import { ZERO_USAGE } from './usage.ts';
import type {
  BuiltPrompt,
  ChatMessage,
  LlmTransport,
  OutputIssue,
  TransportResponse,
} from './types.ts';

/** Repair retries after the first answer; each sends the validation errors back. */
export const MAX_REPAIR_ATTEMPTS = 2;

export interface LlmClientDeps {
  readonly db: Db;
  readonly dataDir: string;
  /** Model per role and the price table. The key lives only in the transport. */
  readonly llm: Pick<LlmSettings, 'models' | 'prices'>;
  readonly transport: LlmTransport;
  readonly now?: () => Date;
}

export interface CallJsonRequest<S extends z.ZodType> {
  readonly role: ModelRole;
  readonly prompt: BuiltPrompt;
  readonly schema: S;
  /** Null (or omitted) for calls outside a run. */
  readonly runId?: number | null;
  readonly stepId?: number | null;
  readonly aliases?: readonly FieldAlias[];
  /**
   * Checks beyond the schema (e.g. registry checks); its issues are repaired the same way. It runs
   * on every answer that parses as JSON, also one that fails the schema (then on the parsed JSON),
   * so one repair message lists every problem: it must accept any JSON value.
   */
  readonly check?: (value: unknown) => readonly OutputIssue[];
  readonly signal?: AbortSignal;
  /** Where normalizer fixes and repairs are reported (a job's `ctx.log`). */
  readonly log?: (level: LogLevel, message: string) => void;
}

export interface CallJsonResult<T> {
  readonly value: T;
  /** `llm_calls` ids, one per attempt. */
  readonly callIds: readonly number[];
  readonly costUsd: number;
  /** Normalizer fixes on the accepted answer. */
  readonly fixes: readonly NormalizerFix[];
}

/** The answer still failed validation after every repair attempt. */
export class LlmOutputInvalidError extends Error {
  override readonly name = 'LlmOutputInvalidError';
  constructor(
    readonly role: ModelRole,
    readonly issues: readonly OutputIssue[],
    readonly callIds: readonly number[],
  ) {
    super(
      `${role} output is still invalid after ${MAX_REPAIR_ATTEMPTS} repair attempts:\n` +
        formatIssues(issues),
    );
  }
}

type Outcome<T> =
  | { ok: true; value: T; fixes: NormalizerFix[] }
  | { ok: false; issues: OutputIssue[]; fixes: NormalizerFix[] };

export interface LlmClient {
  callJson<S extends z.ZodType>(request: CallJsonRequest<S>): Promise<CallJsonResult<z.output<S>>>;
}

export function formatIssues(issues: readonly OutputIssue[]): string {
  return issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n');
}

/** The user turn that asks for a repaired answer. */
export function repairMessage(issues: readonly OutputIssue[]): string {
  return [
    'Your previous answer failed validation. Fix only these problems, keep every other field',
    'exactly as it was, and return the complete corrected JSON object. No prose, no code fences.',
    formatIssues(issues),
  ].join('\n');
}

/**
 * Normalize, then the schema and the extra check together, so one repair covers both. Reasoning
 * content is never read here.
 */
export function evaluateAnswer<S extends z.ZodType>(
  response: Pick<TransportResponse, 'content' | 'finishReason'>,
  request: Pick<CallJsonRequest<S>, 'schema' | 'aliases' | 'check'>,
): Outcome<z.output<S>> {
  if (!response.content?.trim()) {
    const reason = response.finishReason ?? 'unknown';
    return {
      ok: false,
      issues: [{ path: '$', message: `No answer (finish_reason: ${reason})` }],
      fixes: [],
    };
  }
  const normalized = normalizeJsonText(response.content, {
    aliases: request.aliases,
    schema: request.schema,
  });
  if (!normalized.ok) {
    return {
      ok: false,
      issues: [{ path: '$', message: normalized.error }],
      fixes: normalized.fixes,
    };
  }
  const parsed = request.schema.safeParse(normalized.value);
  const issues = parsed.success
    ? [...(request.check?.(parsed.data) ?? [])]
    : [...schemaIssues(parsed.error), ...checkUnvalidated(request.check, normalized.value)];
  if (!parsed.success || issues.length > 0) return { ok: false, issues, fixes: normalized.fixes };
  return { ok: true, value: parsed.data, fixes: normalized.fixes };
}

function schemaIssues(error: z.ZodError): OutputIssue[] {
  return error.issues.map((i) => ({ path: toJsonPath(i.path), code: i.code, message: i.message }));
}

/**
 * The extra check on JSON that failed the schema. A check that throws on an unexpected shape
 * adds nothing: the schema issues are repaired alone and the check runs on the next answer.
 */
function checkUnvalidated(
  check: ((value: unknown) => readonly OutputIssue[]) | undefined,
  value: unknown,
): readonly OutputIssue[] {
  try {
    return check?.(value) ?? [];
  } catch {
    return [];
  }
}

function describeFix(role: ModelRole, fix: NormalizerFix): string {
  const where = fix.path ? ` at ${fix.path}` : '';
  return `${role}: normalizer ${fix.kind}${where}: ${fix.message}`;
}

/** Unique per call, sortable by time: `20261120T091500123Z-director-a0-3fa2c1`. */
function callKey(at: Date, role: ModelRole, attempt: number): string {
  const stamp = at.toISOString().replace(/[-:.]/g, '');
  return `${stamp}-${role}-a${attempt}-${randomBytes(3).toString('hex')}`;
}

export function createLlmClient(deps: LlmClientDeps): LlmClient {
  const now = deps.now ?? (() => new Date());

  async function attempt<S extends z.ZodType>(
    request: CallJsonRequest<S>,
    messages: readonly ChatMessage[],
    attemptNo: number,
  ): Promise<{ row: LlmCallRow; outcome: Outcome<z.output<S>>; content: string }> {
    const { role } = request;
    const model = deps.llm.models[role];
    const price = deps.llm.prices[model];
    if (!price) throw new LlmConfigError(`Model "${model}" has no entry in llm.prices`);
    const startedAt = now();
    const runId = request.runId ?? null;
    const paths = llmCallPaths(runId, callKey(startedAt, role, attemptNo));
    const versions = request.prompt.versions;
    writeDataJson(deps.dataDir, paths.prompt, {
      role,
      model,
      attempt: attemptNo,
      versions,
      messages,
    });

    const base = {
      runId,
      stepId: request.stepId ?? null,
      role,
      promptVersion: versions.role,
      preambleVersion: versions.preamble,
      attempt: attemptNo,
      model,
      promptPath: paths.prompt,
    };
    const started = performance.now();
    let response: TransportResponse;
    try {
      response = await deps.transport.send({ role, model, messages, signal: request.signal });
    } catch (error) {
      insertLlmCall(deps.db, {
        ...base,
        servedModel: null,
        tokensInCached: ZERO_USAGE.inCached,
        tokensInUncached: ZERO_USAGE.inUncached,
        tokensOut: ZERO_USAGE.out,
        tokensReasoning: ZERO_USAGE.reasoning,
        costUsd: 0,
        responsePath: null,
        durationMs: Math.round(performance.now() - started),
        error: (error as Error).message,
        normalizerFixes: [],
      });
      throw error;
    }
    const durationMs = Math.round(performance.now() - started);
    writeDataJson(deps.dataDir, paths.response, {
      servedModel: response.servedModel,
      finishReason: response.finishReason,
      content: response.content,
      reasoningContent: response.reasoningContent,
      usage: response.rawUsage,
    });
    const outcome = evaluateAnswer(response, request);
    const row = insertLlmCall(deps.db, {
      ...base,
      servedModel: response.servedModel,
      tokensInCached: response.usage.inCached,
      tokensInUncached: response.usage.inUncached,
      tokensOut: response.usage.out,
      tokensReasoning: response.usage.reasoning,
      costUsd: callCostUsd(response.usage, price, startedAt),
      responsePath: paths.response,
      durationMs,
      error: outcome.ok ? null : `Invalid output: ${outcome.issues.length} issue(s)`,
      normalizerFixes: outcome.fixes,
    });
    return { row, outcome, content: response.content ?? '' };
  }

  return {
    async callJson<S extends z.ZodType>(request: CallJsonRequest<S>) {
      const messages: ChatMessage[] = [...request.prompt.messages];
      const rows: LlmCallRow[] = [];
      for (let attemptNo = 0; ; attemptNo++) {
        request.signal?.throwIfAborted();
        const { row, outcome, content } = await attempt(request, messages, attemptNo);
        rows.push(row);
        for (const fix of outcome.fixes) request.log?.('info', describeFix(request.role, fix));
        const callIds = rows.map((r) => r.id);
        if (outcome.ok) {
          const costUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
          return { value: outcome.value, callIds, costUsd, fixes: outcome.fixes };
        }
        if (attemptNo >= MAX_REPAIR_ATTEMPTS) {
          throw new LlmOutputInvalidError(request.role, outcome.issues, callIds);
        }
        request.log?.(
          'warn',
          `${request.role}: invalid output (${outcome.issues.length} issue(s)); repair ${attemptNo + 1}/${MAX_REPAIR_ATTEMPTS}`,
        );
        messages.push(
          { role: 'assistant', content },
          { role: 'user', content: repairMessage(outcome.issues) },
        );
      }
    },
  };
}
