import { deriveActionMode, type ActionMode } from '@roadiehq/actions-common';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedAction {
  id: string;
  slug: string;
  mode?: ActionMode | null;
  effectiveMode?: ActionMode;
  steps?: Array<{ request?: { method?: string } }>;
}

type FetchClient = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'json'>>;

export function effectiveMode(action: ResolvedAction): ActionMode {
  return (
    action.effectiveMode ??
    action.mode ??
    deriveActionMode(
      (action.steps ?? []).map(step => ({
        request: { method: step.request?.method ?? 'GET' },
      })),
    )
  );
}

/**
 * Resolves an action reference (uuid or slug) to check its effective mode
 * before running anything. Slug lookup pages through the search results — the
 * slug can sit past the list endpoint's default page size.
 */
export async function resolveAction(
  fetchClient: FetchClient,
  baseUrl: string,
  ref: string,
): Promise<ResolvedAction | undefined> {
  if (UUID_RE.test(ref)) {
    const response = await fetchClient(`${baseUrl}/${encodeURIComponent(ref)}`);
    if (response.ok) {
      return (await response.json()) as ResolvedAction;
    }
    if (response.status !== 404) {
      throw new Error(
        `Failed to look up action: ${response.status} ${response.statusText}`,
      );
    }
  }

  const search = encodeURIComponent(ref);
  for (let offset = 0, total = Infinity; offset < total; ) {
    const response = await fetchClient(
      `${baseUrl}/?search=${search}&offset=${offset}`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to look up action: ${response.status} ${response.statusText}`,
      );
    }
    const result = (await response.json()) as {
      items: ResolvedAction[];
      total: number;
    };
    const action = result.items.find(item => item.slug === ref);
    if (action) return action;
    if (result.items.length === 0) break;
    offset += result.items.length;
    total = result.total;
  }
  return undefined;
}
