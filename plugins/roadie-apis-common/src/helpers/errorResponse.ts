export type ErrorResponse = { error: { message: string } };

export async function parseErrorResponse(response: Response): Promise<never> {
  let message: string | undefined;
  try {
    const payload = await response.json();
    message =
      payload.error?.message ?? payload.error_message ?? payload.message;
  } catch {
    message = response.statusText;
  }
  throw new Error(message ?? `Request failed with status ${response.status}`);
}
