function isUsefulErrorText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value !== '[object Object]'
  );
}

function readErrorText(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (isUsefulErrorText(value)) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  const nested = readErrorText((value as { message?: unknown }).message);
  if (nested) {
    return nested;
  }
  try {
    const json = JSON.stringify(value);
    return json && json !== '{}' && json !== '[object Object]'
      ? json
      : undefined;
  } catch {
    return undefined;
  }
}

export class ResponseError extends Error {
  static async fromResponse(response: Response): Promise<ResponseError> {
    const rawText = await response
      .clone()
      .text()
      .then(text => text.trim())
      .catch(() => undefined);

    let body: unknown;
    try {
      body = rawText ? JSON.parse(rawText) : undefined;
    } catch {
      body = undefined;
    }

    const record =
      typeof body === 'object' && body !== null
        ? (body as { error?: unknown; message?: unknown })
        : undefined;
    const message =
      readErrorText(record?.error) ??
      readErrorText(record?.message) ??
      (rawText && rawText.length > 0 ? rawText : undefined) ??
      `Request failed with status ${response.status} ${response.statusText}`;

    return new ResponseError(message, response.status);
  }

  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ResponseError';
    this.statusCode = statusCode;
  }
}
