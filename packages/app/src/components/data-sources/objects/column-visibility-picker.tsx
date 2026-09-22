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

import { Columns3 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import type { VisibilityState } from '@tanstack/react-table';

interface ColumnVisibilityPickerProps {
  /** Toggleable index-column ids; built-in columns are always shown. */
  columnIds: string[];
  columnVisibility: VisibilityState;
  onColumnVisibleChange: (columnId: string, visible: boolean) => void;
}

/**
 * Toolbar dropdown for showing/hiding a data source's index columns. Built-in
 * columns (expand, object id, relationships, actions) are not offered here —
 * only the per-data-source index columns are optional.
 */
export function ColumnVisibilityPicker({
  columnIds,
  columnVisibility,
  onColumnVisibleChange,
}: ColumnVisibilityPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label="Choose visible columns"
        >
          <Columns3 className="size-3.5" aria-hidden />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Index columns</DropdownMenuLabel>
        {columnIds.map(columnId => (
          <DropdownMenuCheckboxItem
            key={columnId}
            checked={columnVisibility[`${columnId}`] !== false}
            onCheckedChange={checked =>
              onColumnVisibleChange(columnId, checked)
            }
            // Keep the menu open so several columns can be toggled in one visit.
            onSelect={event => event.preventDefault()}
          >
            {columnId}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
