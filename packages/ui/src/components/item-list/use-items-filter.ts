/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState, useMemo, useCallback } from 'react';
import type { BaseItem, FilterState, StatusFilter } from './types';

export type UseItemsFilterOptions<T extends BaseItem> = {
  /** Extra strings matched by the search box (e.g. integration name). */
  extraSearchFields?: (item: T) => Iterable<string | undefined | null>;
};

export function useItemsFilter<T extends BaseItem>(
  items: T[],
  options?: UseItemsFilterOptions<T>,
) {
  const { extraSearchFields } = options ?? {};
  const [filter, setFilter] = useState<FilterState>({
    search: '',
    status: 'all',
  });

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter.status === 'active' && !item.enabled) {
        return false;
      }
      if (filter.status === 'inactive' && item.enabled) {
        return false;
      }

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const nameMatch = item.name.toLowerCase().includes(searchLower);
        const descMatch = item.description?.toLowerCase().includes(searchLower);
        const extras = extraSearchFields ? extraSearchFields(item) : [];
        const extraMatch = [...extras].some(
          field =>
            typeof field === 'string' &&
            field.toLowerCase().includes(searchLower),
        );
        if (!nameMatch && !descMatch && !extraMatch) {
          return false;
        }
      }

      return true;
    });
  }, [items, filter, extraSearchFields]);

  const setSearch = useCallback((search: string) => {
    setFilter(prev => ({ ...prev, search }));
  }, []);

  const setStatus = useCallback((status: StatusFilter) => {
    setFilter(prev => ({ ...prev, status }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilter({ search: '', status: 'all' });
  }, []);

  return {
    filteredItems,
    filter,
    setSearch,
    setStatus,
    clearFilters,
    hasActiveFilters: filter.search !== '' || filter.status !== 'all',
  };
}
