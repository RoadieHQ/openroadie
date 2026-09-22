export type RequestBodyParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function parseRequestBodyText(
  text: string | undefined,
): RequestBodyParseResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    return { ok: true, value };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid JSON',
    };
  }
}
