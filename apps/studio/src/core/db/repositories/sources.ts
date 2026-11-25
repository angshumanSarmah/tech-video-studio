import type { SourceFailureCode } from '@explainer-studio/shared';
import { posix } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { sources } from '../schema.ts';

export type Source = typeof sources.$inferSelect;

export type NewSource =
  | { readonly topicId: number; readonly kind: 'url'; readonly url: string }
  | { readonly topicId: number; readonly kind: 'file'; readonly filePath: string }
  | {
      readonly topicId: number;
      readonly kind: 'text';
      /** The stored pasted text. */
      readonly filePath: string;
      readonly title: string;
    };

export function createSource(db: Executor, input: NewSource): Source {
  return db
    .insert(sources)
    .values({
      topicId: input.topicId,
      kind: input.kind,
      url: input.kind === 'url' ? input.url : null,
      filePath: input.kind === 'url' ? null : input.filePath,
      title: input.kind === 'text' ? input.title : null,
    })
    .returning()
    .get();
}

/** The URL, the uploaded file's name, or the pasted text's title. */
export function sourceOrigin(source: Source): string {
  if (source.kind === 'text') return source.title ?? `Pasted text ${source.id}`;
  return source.url ?? posix.basename(source.filePath ?? `source-${source.id}`);
}

export function getSource(db: Executor, id: number): Source | undefined {
  return db.select().from(sources).where(eq(sources.id, id)).get();
}

/** In the order they were added. */
export function listTopicSources(db: Executor, topicId: number): Source[] {
  return db
    .select()
    .from(sources)
    .where(eq(sources.topicId, topicId))
    .orderBy(asc(sources.id))
    .all();
}

export interface SourceExtraction {
  readonly textPath: string;
  readonly contentHash: string;
  readonly title: string | null;
  readonly extractedAt: Date;
}

export function markSourceExtracted(
  db: Executor,
  id: number,
  extraction: SourceExtraction,
): Source {
  return db
    .update(sources)
    .set({ status: 'extracted', error: null, errorCode: null, ...extraction })
    .where(eq(sources.id, id))
    .returning()
    .get();
}

/** Keeps any earlier text version (and its hash), so runs pinned to it are unaffected. */
export function markSourceFailed(
  db: Executor,
  id: number,
  failure: { readonly code: SourceFailureCode; readonly message: string },
): Source {
  return db
    .update(sources)
    .set({ status: 'failed', error: failure.message, errorCode: failure.code })
    .where(eq(sources.id, id))
    .returning()
    .get();
}
