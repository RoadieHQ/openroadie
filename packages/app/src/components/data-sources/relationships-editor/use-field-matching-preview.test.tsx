import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import { useFieldMatchingPreview } from './use-field-matching-preview';

describe('useFieldMatchingPreview', () => {
  it('automatically evaluates a selected source object', async () => {
    const onPreview = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const { rerender } = renderHook(
      ({ sourceObjectId }: { sourceObjectId: string | null }) =>
        useFieldMatchingPreview({
          open: true,
          isIntegrationBacked: false,
          hasPreviewInputs: true,
          sourceDatasourceId: 'source-ds',
          targetDatasourceId: 'target-ds',
          sourceFieldExpression: '$.id',
          targetFieldExpression: '$.name',
          sourceFilterExpression: '',
          targetFilterExpression: '',
          relationshipType: 'memberOf',
          matchStrategy: 'exact',
          sourceObjectId,
          onPreview,
        }),
      {
        initialProps: { sourceObjectId: null as string | null },
        wrapper: TestQueryProvider,
      },
    );

    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ sourceObjectId: expect.anything() }),
      expect.objectContaining({ sourceObjectId: undefined }),
    );

    rerender({ sourceObjectId: 'source-specific' });

    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(2), {
      timeout: 1500,
    });
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ sourceObjectId: expect.anything() }),
      expect.objectContaining({ sourceObjectId: 'source-specific' }),
    );
  });
});
