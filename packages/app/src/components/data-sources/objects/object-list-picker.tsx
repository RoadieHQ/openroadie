import { useId, useState } from 'react';
import type { SortingState } from '@tanstack/react-table';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { Label } from '@roadiehq/ui/label';
import { Spinner } from '@roadiehq/ui/spinner';
import { Card } from '@roadiehq/ui/card';
import {
  useDataSourceObjects,
  type DataSourceObjectRow,
} from './use-data-source-objects';

const EMPTY_FILTERS = new Map<string, string>();
const EMPTY_SORTING: SortingState = [];

/** Flatten an object payload into `$.path` → scalar rows for preview. */
export function flattenPreviewFields(value: unknown, prefix = '$') {
  const rows: Array<{ path: string; value: string }> = [];
  if (value === null || value === undefined) {
    return rows;
  }
  if (typeof value !== 'object') {
    return [{ path: prefix, value: String(value) }];
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rows.push(...flattenPreviewFields(item, `${prefix}[${index}]`));
    });
    return rows;
  }
  for (const [key, child] of Object.entries(value)) {
    rows.push(...flattenPreviewFields(child, `${prefix}.${key}`));
  }
  return rows;
}

// Identifying fields for a row, data-driven — no assumed object shape. Prefer the
// datasource's configured index values (what the objects table shows); otherwise
// fall back to the object's own scalar fields. Deep/fuzzy search does the finding;
// these let the user recognise which result is which.
function objectPreviewFields(row: DataSourceObjectRow): Array<{
  key: string;
  value: string;
}> {
  // Skip an index that just repeats the id (shown separately), then prefer the
  // remaining configured indexes.
  const indexed = [...row.indexValues.entries()]
    .filter(([, value]) => value !== row.objectId)
    .slice(0, 3)
    .map(([key, value]) => ({ key, value }));
  if (indexed.length > 0) {
    return indexed;
  }
  return flattenPreviewFields(row.object)
    .filter(f => f.value.trim() !== '')
    .slice(0, 3)
    .map(f => ({ key: f.path.replace(/^\$\.?/, ''), value: f.value }));
}

/**
 * Search + datasource-scoped list that resolves one object id. The recognisable
 * object-picking control shared by the example-pair picker (rule inference) and
 * the manual single-edge editor, so choosing an object feels the same in both.
 */
export function ObjectListPicker({
  label,
  datasourceId,
  objectId,
  onObjectIdChange,
  fill = false,
}: {
  label: string;
  datasourceId: string;
  objectId: string;
  onObjectIdChange: (id: string) => void;
  /**
   * Fill the parent height with the search pinned atop a scrolling list (the
   * step editor's sample-search layout). Default is the compact block used in
   * the example-pair picker.
   */
  fill?: boolean;
}) {
  const [search, setSearch] = useState('');
  const searchId = useId();
  const { rows, loading } = useDataSourceObjects({
    datasourceIds: [datasourceId],
    pageIndex: 0,
    pageSize: 20,
    sorting: EMPTY_SORTING,
    search,
    filters: EMPTY_FILTERS,
  });

  const searchInput = (
    <Input
      id={searchId}
      value={search}
      onChange={e => setSearch(e.target.value)}
      placeholder="Search objects..."
      className="h-8 text-sm"
      aria-label={fill ? label : undefined}
    />
  );

  const list = loading ? (
    <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      Loading
    </div>
  ) : rows.length === 0 ? (
    <div className="px-2 py-2 text-xs text-muted-foreground">
      No objects found.
    </div>
  ) : (
    rows.map(row => {
      const preview = objectPreviewFields(row);
      return (
        <Button
          key={row.objectId}
          type="button"
          variant={row.objectId === objectId ? 'default' : 'ghost'}
          className="h-auto w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-xs"
          onClick={() => onObjectIdChange(row.objectId)}
        >
          {preview.length > 0 && (
            <span className="max-w-full min-w-0 truncate">
              {preview.map(f => `${f.key}: ${f.value}`).join(' · ')}
            </span>
          )}
          <span className="max-w-full min-w-0 truncate font-mono text-2xs opacity-70">
            {row.objectId}
          </span>
        </Button>
      );
    })
  );

  // Fill layout: a card panel (matching the other stage panels) with the same
  // compact search-then-list stack the step editor's sample search uses — search
  // pinned at the top, the object list filling and scrolling below.
  if (fill) {
    return (
      <Card variant="flat" className="flex h-full min-w-0 flex-col gap-2 p-2">
        {searchInput}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-1">
          {list}
        </div>
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <Label
        htmlFor={searchId}
        className="block text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      {searchInput}
      <div className="max-h-52 overflow-auto rounded-md border border-border bg-background p-1">
        {list}
      </div>
    </div>
  );
}
