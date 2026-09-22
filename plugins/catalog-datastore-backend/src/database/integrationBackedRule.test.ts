import { applyIntegrationBackedRule } from './integrationBackedRule';

// Minimal stubs — this exercises the dry-run sampling/budget path only, which
// never touches knex or the relationship DAO (no pathExpression is configured).
const logger = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
} as any;

const makeRow = (objectId: string) =>
  ({
    id: `${objectId}-datastore-id`,
    object_id: objectId,
    object: JSON.stringify({ name: objectId }),
  }) as any;

describe('applyIntegrationBackedRule', () => {
  it('keeps a source’s already-fetched edges and response sample when the dry-run call budget is hit mid-source', async () => {
    // One source with 51 distinct lookup values → 51 distinct request paths.
    // The 50-call dry-run budget is exhausted on the 51st value, which lands
    // inside this single source. Its earlier successful calls must still be
    // reflected in the preview rather than discarded.
    const sourceValues = Array.from({ length: 51 }, (_, i) => `v${i}`);
    const sourceRow = makeRow('src-1');
    const targetRow = makeRow('T1');

    const valuesByObjectId: Record<string, string[]> = {
      'src-1': sourceValues,
      T1: ['T1'],
    };
    const evaluateRows = async (rows: any[]) => ({
      items: rows.map(row => ({
        row,
        fieldValues: valuesByObjectId[`${row.object_id}`] ?? [],
      })),
    });

    let calls = 0;
    const callIntegration = async () => {
      calls += 1;
      return { match: 'T1' };
    };

    const rule = {
      id: 'rule-1',
      sourceDatasourceId: 'src-ds',
      targetDatasourceId: 'tgt-ds',
      relationshipType: 'ownedBy',
      sourceFieldExpression: 'login',
      targetFieldExpression: 'login',
      integrationConfig: {
        integrationId: 'int-1',
        method: 'GET',
        path: '/lookup/{value}',
        responseMatchExpression: 'match',
      },
    } as any;

    const result = await applyIntegrationBackedRule({
      rule,
      sourceRows: [sourceRow],
      targetRows: [targetRow],
      callIntegration,
      evaluateRows,
      relationshipDao: {} as any,
      knex: {} as any,
      logger,
      dryRun: true,
    });

    // Budget stops at 50 live calls.
    expect(calls).toBe(50);
    expect(result.callLimitReached).toBe(true);
    expect(result.truncated).toBe(true);

    // The edge resolved before the budget ran out survives (deduped to one
    // source→target edge), and the response sample is retained.
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates?.[0]).toMatchObject({
      sourceObjectId: 'src-1',
      destinationObjectId: 'T1',
      relationshipType: 'ownedBy',
    });
    expect(result.responseSample?.sourceObjectId).toBe('src-1');
  });

  it('omits a source the budget blocked before any lookup instead of reporting it as unmatched', async () => {
    // Source A consumes the full 50-call budget; source B is then reached but
    // its first (and only) value can't be looked up. B was never evaluated, so
    // it must be omitted from the sampled set rather than surfaced as a false
    // "no match".
    const sourceA = makeRow('src-A');
    const sourceB = makeRow('src-B');
    const targetRow = makeRow('T1');

    const valuesByObjectId: Record<string, string[]> = {
      'src-A': Array.from({ length: 50 }, (_, i) => `a${i}`),
      'src-B': ['b0'],
      T1: ['T1'],
    };
    const evaluateRows = async (rows: any[]) => ({
      items: rows.map(row => ({
        row,
        fieldValues: valuesByObjectId[`${row.object_id}`] ?? [],
      })),
    });

    let calls = 0;
    const callIntegration = async () => {
      calls += 1;
      return { match: 'T1' };
    };

    const rule = {
      id: 'rule-1',
      sourceDatasourceId: 'src-ds',
      targetDatasourceId: 'tgt-ds',
      relationshipType: 'ownedBy',
      sourceFieldExpression: 'login',
      targetFieldExpression: 'login',
      integrationConfig: {
        integrationId: 'int-1',
        method: 'GET',
        path: '/lookup/{value}',
        responseMatchExpression: 'match',
      },
    } as any;

    const result = await applyIntegrationBackedRule({
      rule,
      sourceRows: [sourceA, sourceB],
      targetRows: [targetRow],
      callIntegration,
      evaluateRows,
      relationshipDao: {} as any,
      knex: {} as any,
      logger,
      dryRun: true,
    });

    expect(calls).toBe(50);
    expect(result.callLimitReached).toBe(true);
    // Only source A was evaluated; B is omitted, not reported as unmatched.
    expect(result.sampled).toBe(1);
    expect(result.sampledSourceObjectIds).toEqual(['src-A']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates?.[0]).toMatchObject({ sourceObjectId: 'src-A' });
  });
});
