import { EVENT_TYPES, EventDtoSchema, type EventDto } from '@explainer-studio/shared';
import {
  computed,
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';
import { eventsUrl, type EventStreamFilter } from '#web/http/events.ts';

/** `idle`: no filter yet. `reconnecting`: the browser is retrying after a dropped connection. */
export type StreamState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventStreamOptions {
  /** Close the stream after this event (e.g. the job finished). */
  readonly closeWhen?: (event: EventDto) => boolean;
}

const EVENT_SOURCE_CLOSED = 2;

/**
 * Subscribes to `GET /api/events` over SSE. Opens when `filter` is non-null, reopens when it
 * changes and closes when the calling scope is disposed. Each message is parsed with
 * `EventDtoSchema`. On a dropped connection `EventSource` reconnects by itself and resends
 * `Last-Event-ID`, so the server resumes after the last event received.
 */
export function useEventStream(
  filter: MaybeRefOrGetter<EventStreamFilter | null>,
  options: EventStreamOptions = {},
) {
  const events = shallowRef<readonly EventDto[]>([]);
  const state = ref<StreamState>('idle');
  const error = ref<string | null>(null);
  let source: EventSource | null = null;

  function close(): void {
    source?.close();
    source = null;
    if (state.value !== 'idle') state.value = 'closed';
  }

  function receive(message: MessageEvent<string>): void {
    const event = parseEvent(message.data);
    if (!event) {
      error.value = `Malformed event ${message.lastEventId}`;
      return;
    }
    events.value = [...events.value, event];
    if (options.closeWhen?.(event)) close();
  }

  function onError(): void {
    if (source?.readyState !== EVENT_SOURCE_CLOSED) {
      state.value = 'reconnecting';
      return;
    }
    error.value = 'Event stream failed';
    close();
  }

  function open(url: string): void {
    const opened = new EventSource(url);
    source = opened;
    state.value = 'connecting';
    opened.addEventListener('open', () => (state.value = 'open'));
    opened.addEventListener('error', onError);
    // The server names each message after its event type, so `onmessage` never fires.
    for (const type of EVENT_TYPES) opened.addEventListener(type, receive);
  }

  const url = computed(() => {
    const value = toValue(filter);
    return value ? eventsUrl(value) : null;
  });

  watch(
    url,
    (next) => {
      close();
      events.value = [];
      error.value = null;
      state.value = 'idle';
      if (next) open(next);
    },
    { immediate: true },
  );
  onScopeDispose(close);

  return { events, state: readonly(state), error: readonly(error), close };
}

export type EventStream = ReturnType<typeof useEventStream>;

function parseEvent(data: string): EventDto | undefined {
  try {
    const parsed = EventDtoSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
