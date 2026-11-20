import type { RawUsage } from './usage.ts';

/** Test-only helpers: a scripted `fetch` standing in for the HTTP layer. */

export interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: { model: string; messages: { role: string; content: string }[] };
}

type Reply = Response | ((init: RequestInit) => Response | Promise<Response>);

/** A chat completion body in the API's shape (DeepSeek usage fields by default). */
export interface CompletionOptions {
  readonly content: string | null;
  readonly reasoning?: string;
  readonly model?: string;
  readonly finishReason?: string;
  readonly usage?: RawUsage;
}

export function completionBody(options: CompletionOptions): unknown {
  return {
    id: 'cmpl-test',
    model: options.model ?? 'served-model-0001',
    choices: [
      {
        index: 0,
        finish_reason: options.finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content: options.content,
          ...(options.reasoning === undefined ? {} : { reasoning_content: options.reasoning }),
        },
      },
    ],
    usage: options.usage ?? {
      prompt_tokens: 1_000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    },
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function completion(
  content: string | null,
  extra: Omit<CompletionOptions, 'content'> = {},
): Response {
  return jsonResponse(completionBody({ content, ...extra }));
}

/** Replies in order; throws when a request arrives after the script ends. */
export function scriptedFetch(replies: readonly Reply[]): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const queue = [...replies];
  const requests: RecordedRequest[] = [];
  const fake = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init, body: JSON.parse(init.body as string) as RecordedRequest['body'] });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request #${requests.length} to ${url}`);
    return typeof next === 'function' ? next(init) : next;
  };
  return { fetch: fake, requests };
}

/** A reply that never resolves until the request's signal aborts (timeouts, cancellation). */
export function hangUntilAborted(init: RequestInit): Promise<Response> {
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

/**
 * A 200 response whose body stream breaks after `prefix`, as when the connection drops mid-body
 * (undici reports "terminated").
 */
export function cutOffResponse(prefix = '{"id":"cmpl-test","choices":['): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(prefix));
      controller.error(new TypeError('terminated'));
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}
