import { useActions as useActionsApi } from '../../api';
import { actionsListQuery } from '../../api/queries';
import { useListQuery } from '../../api/query-hooks';

export function useActions() {
  const actionsApi = useActionsApi();

  const { items, total, loading, error, retry } = useListQuery(
    actionsListQuery(actionsApi),
  );

  return {
    actions: items,
    total,
    // `loading` is true until the first result resolves, so the page shows a
    // single stable loading state instead of empty → spinner → content.
    loading,
    error,
    retry,
  };
}
