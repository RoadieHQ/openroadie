export interface BrowserEntityChange {
  entity: 'actions' | 'capabilities' | 'workflows';
  operation: 'created' | 'updated' | 'deleted' | 'restored';
}

interface SubscribeOptions {
  url: string;
  fetch: typeof fetch;
  onChange: (change: BrowserEntityChange) => void;
  onReconnect?: () => void;
  maxReconnectDelayMs?: number;
}

function isBrowserEntityChange(value: unknown): value is BrowserEntityChange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    'entity' in value &&
    (value.entity === 'actions' ||
      value.entity === 'capabilities' ||
      value.entity === 'workflows') &&
    'operation' in value &&
    (value.operation === 'created' ||
      value.operation === 'updated' ||
      value.operation === 'deleted' ||
      value.operation === 'restored')
  );
}

async function readEntityChanges(
  response: Response,
  signal: AbortSignal,
  onChange: (change: BrowserEntityChange) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Entity change stream has no response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';
  let dataLines: string[] = [];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') {
          if (eventType === 'entity-change' && dataLines.length > 0) {
            try {
              const change: unknown = JSON.parse(dataLines.join('\n'));
              if (isBrowserEntityChange(change)) {
                onChange(change);
              }
            } catch {
              dataLines = [];
            }
          }
          eventType = '';
          dataLines = [];
        } else if (line.startsWith('event:')) {
          eventType = line.slice(6).trimStart();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function subscribeToEntityChanges(options: SubscribeOptions) {
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
  let abortController: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let closed = false;

  const scheduleReconnect = () => {
    if (closed) {
      return;
    }
    reconnectAttempt += 1;
    const delay = Math.min(
      1000 * 2 ** (reconnectAttempt - 1),
      maxReconnectDelayMs,
    );
    reconnectTimer = setTimeout(() => {
      void connect();
    }, delay);
  };

  const connect = async () => {
    abortController = new AbortController();
    try {
      const response = await options.fetch(options.url, {
        headers: { Accept: 'text/event-stream' },
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Entity change stream returned ${response.status}`);
      }
      if (reconnectAttempt > 0) {
        options.onReconnect?.();
      }
      reconnectAttempt = 0;
      await readEntityChanges(
        response,
        abortController.signal,
        options.onChange,
      );
      scheduleReconnect();
    } catch (error) {
      if (
        !closed &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        scheduleReconnect();
      }
    }
  };

  void connect();

  return () => {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    abortController?.abort();
  };
}
