import type { SourceFailureCode } from '@explainer-studio/shared';

/**
 * A source that could not be ingested. The message is shown on the source as-is, so it says what
 * happened and what to do instead. It never fails the job: the run continues with the others.
 */
export class SourceIngestError extends Error {
  override readonly name = 'SourceIngestError';
  constructor(
    readonly code: SourceFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const UPLOAD_INSTEAD = 'upload the page as a file instead (.pdf, or its text as .md or .txt)';

export interface HttpFailureContext {
  readonly status: number;
  /** Total attempts made, for 429 and 5xx (retried before giving up). */
  readonly attempts: number;
  /** GitHub reports an exhausted API quota as a 403 with `x-ratelimit-remaining: 0`. */
  readonly rateLimitRemaining?: string | null;
}

/** The failure for a final non-2xx response. */
export function httpFailure({
  status,
  attempts,
  rateLimitRemaining,
}: HttpFailureContext): SourceIngestError {
  const http = `HTTP ${status}`;
  if (status === 403 && rateLimitRemaining === '0') {
    return new SourceIngestError(
      'rate_limited',
      `${http}: the API's hourly rate limit is used up. Retry in an hour, or ${UPLOAD_INSTEAD}.`,
    );
  }
  if (status === 401 || status === 407) {
    return new SourceIngestError(
      'blocked',
      `${http}: the page needs a login, so ${UPLOAD_INSTEAD}.`,
    );
  }
  if (status === 403 || status === 451) {
    return new SourceIngestError(
      'blocked',
      `${http}: the site blocks automated access, so ${UPLOAD_INSTEAD}.`,
    );
  }
  if (status === 404 || status === 410) {
    return new SourceIngestError('not_found', `${http}: the page was not found. Check the URL.`);
  }
  const gaveUp = `gave up after ${attempts} attempt${attempts === 1 ? '' : 's'}`;
  if (status === 429) {
    return new SourceIngestError(
      'rate_limited',
      `${http}: the site is rate limiting requests (${gaveUp}). Retry later, or ${UPLOAD_INSTEAD}.`,
    );
  }
  if (status >= 500) {
    return new SourceIngestError(
      'server_error',
      `${http}: the site had a server error (${gaveUp}). Retry later.`,
    );
  }
  return new SourceIngestError('http_error', `${http}: the site refused the request.`);
}
