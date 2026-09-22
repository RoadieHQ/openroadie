import jsonataSafe from '@roadiehq/jsonata-safe';

type JsonataExpression = ReturnType<typeof jsonataSafe>;

export async function buildResults(
  objects: unknown[],
  objectIdExpr: JsonataExpression,
  objectIdExpression: string,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const obj of objects) {
    let objectId = await objectIdExpr.evaluate(obj);
    if (objectId == null || objectId === '') {
      if (typeof obj === 'string' || typeof obj === 'number') {
        objectId = obj;
      } else if (typeof obj === 'object' && obj !== null) {
        const record = obj as Record<string, unknown>;
        const fallbackId =
          record.id ??
          record.uuid ??
          record.uid ??
          record._id ??
          record.objectID ??
          record.pk ??
          record.identifier ??
          record.key ??
          record.slug ??
          record.username ??
          record.login ??
          record.email ??
          record.name ??
          record.code ??
          record.symbol ??
          record.number;
        if (
          (typeof fallbackId === 'string' && fallbackId !== '') ||
          typeof fallbackId === 'number'
        ) {
          objectId = fallbackId;
        }
      }
    }
    if (
      (typeof objectId !== 'string' && typeof objectId !== 'number') ||
      objectId === ''
    ) {
      const sample = JSON.stringify(obj, null, 2);
      throw new Error(
        `Could not extract a unique ID from the response. ` +
          `The Object ID expression "${objectIdExpression}" did not match any field. ` +
          `Update the expression in the source node's advanced settings to point to a field that exists in your data. ` +
          `Example object:\n${sample}`,
      );
    }
    if (typeof obj === 'object' && obj !== null) {
      results.push({ ...(obj as object), id: String(objectId) });
    } else {
      results.push({ value: obj, id: String(objectId) });
    }
  }
  return results;
}
