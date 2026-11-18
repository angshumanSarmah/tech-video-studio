import type { EventDto, EventPayload, EventType, RunDto } from '@explainer-studio/shared';
import { vi } from 'vitest';

/** Test-only helpers for web specs. Not imported by the app. */

type Listener = (event: Event) => void;

/** In-memory `EventSource`. Install with `vi.stubGlobal('EventSource', FakeEventSource)`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error('No EventSource was opened');
    return source;
  }

  readyState = 0;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = 2;
  }

  get closed(): boolean {
    return this.readyState === 2;
  }

  open(): void {
    this.readyState = 1;
    this.dispatch(new Event('open'));
  }

  /** Delivers a server event the way `streamTail` writes it (named after its type). */
  emit(event: EventDto): void {
    this.emitRaw(event.type, JSON.stringify(event), String(event.id));
  }

  emitRaw(type: string, data: string, lastEventId = ''): void {
    this.dispatch(new MessageEvent(type, { data, lastEventId }));
  }

  /** `readyState` 0 = the browser will retry, 2 = gave up (e.g. a 404). */
  fail(readyState: 0 | 2): void {
    this.readyState = readyState;
    this.dispatch(new Event('error'));
  }

  private dispatch(event: Event): void {
    if (this.readyState === 2 && event.type !== 'error') return;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

export function installFakeEventSource(): void {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
}

let nextEventId = 1;

export function makeEvent<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
  owner: { runId?: number; jobId?: number } = {},
): EventDto {
  return {
    id: nextEventId++,
    runId: owner.runId ?? null,
    jobId: owner.jobId ?? null,
    createdAt: new Date().toISOString(),
    type,
    payload,
  } as EventDto;
}

export function makeRun(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 1,
    topicId: 1,
    seriesId: 1,
    status: 'queued',
    currentStage: null,
    settings: {
      autoApprove: { research: false, beat_sheet: false, scenes: false, draft: false },
    },
    lastError: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Stubs `fetch` with responses keyed by `"<METHOD> <path>"`. A plain value is sent as 200 JSON;
 * pass a function for any other response. Unknown requests get a 404.
 */
export function stubFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${requestPath(input)}`;
    const route = routes[key];
    if (route === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      typeof route === 'function' ? (route as () => Response)() : Response.json(route),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.pathname + input.search : input.url;
}
