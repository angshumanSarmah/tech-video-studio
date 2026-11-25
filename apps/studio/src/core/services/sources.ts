import { createHash } from 'node:crypto';
import {
  MAX_SOURCE_BYTES,
  PASTED_TEXT_FILE_NAME,
  UPLOAD_EXTENSIONS,
  uploadExtension,
  type AddSourceRequest,
} from '@explainer-studio/shared';
import { sourceUploadPath, writeDataFileOnce } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { createSource, listTopicSources, type Source } from '../db/repositories/sources.ts';
import { getTopic } from '../db/repositories/topics.ts';
import { InvalidSourceError, NotFoundError } from '../errors.ts';

/**
 * Adding sources to a topic (P1C.2, P1D.1): a URL, text pasted with a title, or an uploaded file.
 * Files and pasted text are stored under the topic before their row is inserted (the row holds
 * the path), content-addressed, so adding the same text twice writes it once. Nothing is fetched
 * or read here: the next run's ingest job does that.
 */

export function listSources(db: Executor, topicId: number): Source[] {
  requireTopic(db, topicId);
  return listTopicSources(db, topicId);
}

export function addSource(
  db: Executor,
  dataDir: string,
  topicId: number,
  request: AddSourceRequest,
): Source {
  requireTopic(db, topicId);
  if (request.kind === 'url') return createSource(db, { topicId, kind: 'url', url: request.url });
  const bytes = new TextEncoder().encode(`${request.text}\n`);
  const filePath = storeFile(dataDir, topicId, PASTED_TEXT_FILE_NAME, bytes);
  return createSource(db, { topicId, kind: 'text', filePath, title: request.title });
}

export interface Upload {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function uploadSource(
  db: Executor,
  dataDir: string,
  topicId: number,
  upload: Upload,
): Source {
  requireTopic(db, topicId);
  if (!uploadExtension(upload.name)) {
    throw new InvalidSourceError(
      `${upload.name}: only ${UPLOAD_EXTENSIONS.join(', ')} files are read. Paste the text instead.`,
    );
  }
  if (upload.bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new InvalidSourceError(
      `${upload.name} is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB: upload the part that matters.`,
    );
  }
  if (upload.bytes.byteLength === 0) throw new InvalidSourceError(`${upload.name} is empty.`);
  const filePath = storeFile(dataDir, topicId, upload.name, upload.bytes);
  return createSource(db, { topicId, kind: 'file', filePath });
}

function storeFile(dataDir: string, topicId: number, name: string, bytes: Uint8Array): string {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return writeDataFileOnce(dataDir, sourceUploadPath(topicId, hash, name), bytes);
}

function requireTopic(db: Executor, topicId: number): void {
  if (!getTopic(db, topicId)) throw new NotFoundError('Topic', topicId);
}
