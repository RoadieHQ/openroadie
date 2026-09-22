/**
 * Shareable `?object=` drawer param used by the Datastore table and graph
 * pages: datasource + object id, slash-separated, each URI-encoded.
 */
export function objectDrawerParam(
  datasourceId: string,
  objectId: string,
): string {
  return `${encodeURIComponent(datasourceId)}/${encodeURIComponent(objectId)}`;
}

export function parseObjectDrawerParam(
  param: string,
): { datasourceId: string; objectId: string } | null {
  const slash = param.indexOf('/');
  if (slash < 0) return null;
  try {
    return {
      datasourceId: decodeURIComponent(param.slice(0, slash)),
      objectId: decodeURIComponent(param.slice(slash + 1)),
    };
  } catch {
    return null;
  }
}
