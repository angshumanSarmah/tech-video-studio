/** Test-only helpers for source fetching. Not imported by any entrypoint. */

export type Reply = Response | ((init: RequestInit) => Promise<Response>);

export interface FakeWeb {
  readonly fetch: typeof fetch;
  /** Every request URL in order, with its headers. */
  readonly requests: { url: string; headers: Record<string, string> }[];
  /** Waits requested through `sleep`, in ms. */
  readonly sleeps: number[];
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * A fake web: each URL answers with its replies in order (the last one repeats). Unknown URLs
 * fail like a DNS error. `sleep` records the wait and returns at once.
 */
export function fakeWeb(routes: Readonly<Record<string, Reply | readonly Reply[]>>): FakeWeb {
  const served = new Map<string, number>();
  const requests: FakeWeb['requests'] = [];
  const sleeps: number[] = [];
  const fake = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    const route = routes[url];
    if (route === undefined) {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }
    const replies: readonly Reply[] = isReplyList(route) ? route : [route];
    const n = served.get(url) ?? 0;
    served.set(url, n + 1);
    const reply = replies[Math.min(n, replies.length - 1)]!;
    const response = typeof reply === 'function' ? await reply(init) : reply.clone();
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  return {
    fetch: fake,
    requests,
    sleeps,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

function isReplyList(route: Reply | readonly Reply[]): route is readonly Reply[] {
  return Array.isArray(route);
}

export function body(
  content: string | Uint8Array,
  contentType: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const payload = typeof content === 'string' ? content : new Uint8Array(content);
  return new Response(payload, { status, headers: { 'content-type': contentType, ...headers } });
}

export function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(`status ${code}`, { status: code, headers });
}

/** Never answers until the request is aborted (a timeout or a shutdown). */
export function hang(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      {
        once: true,
      },
    );
  });
}
