import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries';
import { syncContextGroupsAfterEdgeWrite } from './context-group-sync';

describe('syncContextGroupsAfterEdgeWrite', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  });

  it('rebuilds each datasource once, then refetches the group surfaces', async () => {
    const materializeContextGroupsForDatasource = vi
      .fn()
      .mockResolvedValue(undefined);

    await syncContextGroupsAfterEdgeWrite(
      queryClient,
      { materializeContextGroupsForDatasource },
      ['ds-1', 'ds-2', 'ds-1'],
      '__organization__',
    );

    expect(materializeContextGroupsForDatasource.mock.calls).toEqual([
      ['ds-1'],
      ['ds-2'],
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.contextGroupsPrefix,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.objectContextGroupsPrefix,
    });
  });

  it('still refetches when the rebuild call fails', async () => {
    const materializeContextGroupsForDatasource = vi
      .fn()
      .mockRejectedValue(new Error('403'));

    await expect(
      syncContextGroupsAfterEdgeWrite(
        queryClient,
        { materializeContextGroupsForDatasource },
        ['ds-1'],
        '__organization__',
      ),
    ).resolves.toBeUndefined();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.contextGroupsPrefix,
    });
  });

  it('is a no-op with no changed datasources', async () => {
    const materializeContextGroupsForDatasource = vi.fn();

    await syncContextGroupsAfterEdgeWrite(
      queryClient,
      { materializeContextGroupsForDatasource },
      [],
      '__organization__',
    );

    expect(materializeContextGroupsForDatasource).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
