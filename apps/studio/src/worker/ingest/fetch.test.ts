import { describe, expect, it } from 'vitest';
import { SourceIngestError } from './errors.ts';
import { fetchSource, USER_AGENT, type FetchDeps } from './fetch.ts';
import type { SourceRequest } from './github.ts';
import { body, fakeWeb, hang, status, type Reply } from './testing.ts';

const URL_ = 'https://notes.example.com/posts/wal';
const request: SourceRequest = { url: URL_, headers: {}, name: 'wal' };
const never = new AbortController().signal;

function setup(replies: Reply | readonly Reply[], extra: FetchDeps = {}) {
  const web = fakeWeb({ [URL_]: replies });
  const deps: FetchDeps = { fetch: web.fetch, sleep: web.sleep, timeoutMs: 50, ...extra };
  return { web, run: (signal = never) => fetchSource(request, signal, deps) };
}

async function failure(promise: Promise<unknown>): Promise<SourceIngestError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SourceIngestError);
  return error as SourceIngestError;
}

describe('fetchSource', () => {
  it('returns the body, content type and final URL, with an honest UA and Accept header', async () => {
    const { web, run } = setup(body('<p>hello</p>', 'text/html; charset=utf-8'));
    const fetched = await run();
    expect(new TextDecoder().decode(fetched.bytes)).toBe('<p>hello</p>');
    expect(fetched.contentType).toBe('text/html; charset=utf-8');
    expect(fetched.url).toBe(URL_);
    const ua = web.requests[0]!.headers['user-agent'];
    expect(ua).toBe('Mozilla/5.0 (compatible; TechExplainerStudio/1.0)');
    expect(ua).toBe(USER_AGENT);
    expect(ua).not.toMatch(/Chrome|Safari|AppleWebKit|Gecko/);
    expect(web.requests[0]!.headers.accept).toContain('application/pdf');
  });

  it('retries 429 after the Retry-After the server asked for', async () => {
    const { web, run } = setup([status(429, { 'retry-after': '3' }), body('ok', 'text/plain')]);
    await run();
    expect(web.requests).toHaveLength(2);
    expect(web.sleeps).toEqual([3_000]);
  });

  it('retries 5xx twice with backoff, then fails with the reason', async () => {
    const { web, run } = setup(status(503));
    const error = await failure(run());
    expect(web.requests).toHaveLength(3);
    expect(web.sleeps).toEqual([1_000, 2_000]);
    expect(error.code).toBe('server_error');
    expect(error.message).toBe(
      'HTTP 503: the site had a server error (gave up after 3 attempts). Retry later.',
    );
  });

  it('fails at once on a Retry-After past the cap', async () => {
    const { web, run } = setup(status(429, { 'retry-after': '3600' }));
    const error = await failure(run());
    expect(web.requests).toHaveLength(1);
    expect(error.code).toBe('rate_limited');
    expect(error.message).toMatch(/asked to wait too long/);
  });

  it('does not retry a 403 (a site refusing the honest UA) and says to paste or upload the page instead', async () => {
    const { web, run } = setup(status(403));
    const error = await failure(run());
    expect(web.requests).toHaveLength(1);
    expect(web.requests[0]!.headers['user-agent']).toBe(USER_AGENT);
    expect(error.code).toBe('blocked');
    expect(error.message).toBe(
      'HTTP 403: the site blocks automated access, so paste its text as a source instead, or ' +
        'upload the page as a file (.pdf, .md or .txt).',
    );
  });

  it('reads GitHub’s exhausted API quota as a rate limit, not a block', async () => {
    const { run } = setup(status(403, { 'x-ratelimit-remaining': '0' }));
    expect((await failure(run())).code).toBe('rate_limited');
  });

  it('maps 404 to not_found', async () => {
    const { run } = setup(status(404));
    expect((await failure(run())).message).toBe('HTTP 404: the page was not found. Check the URL.');
  });

  it('retries a timeout, then succeeds', async () => {
    const { web, run } = setup([hang, body('late but fine', 'text/plain')]);
    const fetched = await run();
    expect(new TextDecoder().decode(fetched.bytes)).toBe('late but fine');
    expect(web.requests).toHaveLength(2);
    expect(web.sleeps).toEqual([1_000]);
  });

  it('fails as timeout after three timed-out attempts', async () => {
    const { web, run } = setup(hang);
    const error = await failure(run());
    expect(web.requests).toHaveLength(3);
    expect(error.code).toBe('timeout');
    expect(error.message).toMatch(/^No complete response within 0.05 s \(3 attempts\)/);
  });

  it('refuses a body whose Content-Length is over the limit without reading it', async () => {
    const { run } = setup(body('x'.repeat(10), 'text/plain', 200, { 'content-length': '10' }), {
      maxBytes: 5,
    });
    expect((await failure(run())).code).toBe('too_large');
  });

  it('stops reading a streamed body once it passes the limit', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(4));
      },
    });
    const { run } = setup(new Response(endless, { headers: { 'content-type': 'text/plain' } }), {
      maxBytes: 10,
    });
    const error = await failure(run());
    expect(error.code).toBe('too_large');
    expect(pulled).toBeLessThan(10);
  });

  it('reports a connection failure with its code', async () => {
    const web = fakeWeb({});
    const error = await failure(
      fetchSource(request, never, { fetch: web.fetch, sleep: web.sleep }),
    );
    expect(error.code).toBe('network');
    expect(error.message).toMatch(/^Could not connect \(ENOTFOUND\)/);
  });

  it('rethrows a shutdown abort instead of reporting a source failure', async () => {
    const { run } = setup(hang);
    const controller = new AbortController();
    const shutdown = new Error('worker shutting down');
    const pending = run(controller.signal);
    controller.abort(shutdown);
    await expect(pending).rejects.toBe(shutdown);
  });
});
