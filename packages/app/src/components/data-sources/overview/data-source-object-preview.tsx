import { Link } from 'react-router';
import type { DatastoreObject } from '../../../api/datastore/datastore-client';
import { dataSourceObjects, objectDetail } from '../../../config/paths';
import { DetailSection, PreviewTable, type PreviewColumn } from '../../common';
import { resolveObjectDisplayName } from '../objects/resolve-object-display-name';

/** `db_instance_identifier`/`resourceType` → "Db instance identifier" etc. */
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface SummaryField {
  key: string;
  value: string;
}

/**
 * A few readable top-level fields for an object, instead of a raw JSON dump.
 * Skips nested objects/arrays and the field that just repeats the object id.
 */
function summaryFields(
  object: DatastoreObject['object'],
  objectId: string,
): SummaryField[] {
  if (object == null || typeof object !== 'object' || Array.isArray(object)) {
    return [];
  }
  const fields: SummaryField[] = [];
  for (const [key, value] of Object.entries(object)) {
    if (value == null || typeof value === 'object') continue;
    const str = String(value).trim();
    if (!str || str === objectId) continue;
    fields.push({ key: humanizeKey(key), value: str });
    if (fields.length >= 3) break;
  }
  return fields;
}

const DETAILS_COLUMN: PreviewColumn<DatastoreObject> = {
  key: 'details',
  header: 'Details',
  className: 'align-top',
  cell: row => {
    const fields = summaryFields(row.object, row.objectId);
    if (fields.length === 0) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return (
      <div className="flex flex-col gap-0.5">
        {fields.map(field => (
          <div key={field.key} className="flex min-w-0 gap-1.5 text-xs">
            <span className="shrink-0 text-muted-foreground">{field.key}</span>
            <span className="min-w-0 truncate text-foreground">
              {field.value}
            </span>
          </div>
        ))}
      </div>
    );
  },
};

interface DataSourceObjectPreviewProps {
  dataSourceId: string;
  objectCount: number | undefined;
  rows: DatastoreObject[];
  loading: boolean;
}

export function DataSourceObjectPreview({
  dataSourceId,
  objectCount,
  rows,
  loading,
}: DataSourceObjectPreviewProps) {
  const columns: PreviewColumn<DatastoreObject>[] = [
    {
      key: 'objectId',
      header: 'Object',
      className: 'w-2/5 align-top',
      // Real link (accessible affordance); the whole row also navigates below.
      cell: row => {
        const title = resolveObjectDisplayName(
          row.object,
          row.objectId,
          row.presentation,
        );
        return (
          <Link
            to={objectDetail(dataSourceId, row.objectId)}
            className="motion-colors flex min-w-0 flex-col hover:underline"
            title={row.objectId}
          >
            <span className="truncate text-sm font-medium text-foreground">
              {title}
            </span>
            {row.presentation?.subtitle ? (
              <span className="truncate text-xs text-muted-foreground">
                {row.presentation.subtitle}
              </span>
            ) : null}
            <span className="truncate font-mono text-2xs text-muted-foreground">
              ID {row.objectId}
            </span>
          </Link>
        );
      },
    },
    DETAILS_COLUMN,
  ];

  return (
    <DetailSection
      title="Object preview"
      actions={
        objectCount ? (
          <Link
            to={dataSourceObjects(dataSourceId)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View all
          </Link>
        ) : undefined
      }
    >
      <PreviewTable
        columns={columns}
        rows={rows}
        getRowId={row => row.id}
        rowHref={row => objectDetail(dataSourceId, row.objectId)}
        loading={loading}
        skeletonRows={3}
        emptyMessage="No objects stored yet."
      />
    </DetailSection>
  );
}
