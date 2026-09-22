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

import { useCallback, useRef } from 'react';
import { useLocalStorage } from 'react-use';
import type { OnChangeFn, VisibilityState } from '@tanstack/react-table';
import { getWorkspaceStorageScopeKey } from '../../../api/workspace-scope';

const STORAGE_KEY_PREFIX = 'roadie.data-sources.objects.columns.';

interface UseObjectColumnVisibilityResult {
  /** TanStack visibility state: column id → visible (absent = visible). */
  columnVisibility: VisibilityState;
  /** Wire straight into `useReactTable`'s `onColumnVisibilityChange`. */
  onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  setColumnVisible: (columnId: string, visible: boolean) => void;
}

// Persists which index columns are shown, per data source. Reads previous
// state via a ref (same workaround as `use-favorite-data-sources.ts`) because
// `react-use`'s functional setter captures stale state.
export function useObjectColumnVisibility(
  datasourceId: string,
): UseObjectColumnVisibilityResult {
  const workspaceKey = getWorkspaceStorageScopeKey();
  const scopeSuffix =
    workspaceKey === '__organization__' ? '' : `${workspaceKey}.`;
  const [stored, setStored] = useLocalStorage<VisibilityState>(
    `${STORAGE_KEY_PREFIX}${scopeSuffix}${datasourceId}`,
  );
  const ref = useRef<VisibilityState>(stored ?? {});
  ref.current = stored ?? {};

  const onColumnVisibilityChange = useCallback<OnChangeFn<VisibilityState>>(
    updater => {
      setStored(typeof updater === 'function' ? updater(ref.current) : updater);
    },
    [setStored],
  );

  const setColumnVisible = useCallback(
    (columnId: string, visible: boolean) => {
      setStored({ ...ref.current, [`${columnId}`]: visible });
    },
    [setStored],
  );

  return {
    columnVisibility: stored ?? {},
    onColumnVisibilityChange,
    setColumnVisible,
  };
}
