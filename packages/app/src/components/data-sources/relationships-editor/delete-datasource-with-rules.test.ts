import { describe, expect, it, vi } from 'vitest';
import { deleteDatasourceWithRules } from './delete-datasource-with-rules';

describe('deleteDatasourceWithRules', () => {
  it('preserves relationship rules when datasource deletion fails', async () => {
    const deleteDatasource = vi
      .fn()
      .mockRejectedValue(new Error('datasource deletion failed'));
    const deleteRule = vi.fn();

    await expect(
      deleteDatasourceWithRules({
        datasourceId: 'datasource-1',
        relatedRuleIds: ['rule-1', 'rule-2'],
        deleteDatasource,
        deleteRule,
      }),
    ).rejects.toThrow('datasource deletion failed');

    expect(deleteRule).not.toHaveBeenCalled();
  });

  it('reports failed rule cleanup while continuing the remaining deletions', async () => {
    const deleteDatasource = vi.fn().mockResolvedValue(undefined);
    const deleteRule = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rule deletion failed'))
      .mockResolvedValueOnce(undefined);

    const result = await deleteDatasourceWithRules({
      datasourceId: 'datasource-1',
      relatedRuleIds: ['rule-1', 'rule-2', 'rule-3'],
      deleteDatasource,
      deleteRule,
    });

    expect(deleteRule).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ failedRuleIds: ['rule-2'] });
  });
});
