import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListFilter, X } from 'lucide-react';
import {
  parseFilterConditions,
  type FilterCondition,
  type FilterOperator,
} from '@roadiehq/catalog-datastore-common';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { useDatastore } from '../../../api';
import { contextGroupFieldProfilesQuery } from '../../../api/queries';

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
];

const NEW_CONDITION: FilterCondition = {
  field: '',
  operator: 'equals',
  value: '',
};

/**
 * Per-datasource membership filters for a context group rule: each condition
 * is a field (picked from the datasource's profiled fields), a comparison
 * operator, and a value. Objects must match every condition to enter a group.
 * Edits round-trip through the rule's serialized `filter` string; blank rows
 * are kept while editing and stripped on save.
 */
export function DatasourceFilterEditor({
  datasourceId,
  datasourceName,
  filter,
  onChange,
}: {
  datasourceId: string;
  datasourceName: string;
  filter?: string;
  onChange: (filter: string | undefined) => void;
}) {
  const datastore = useDatastore();
  const conditions = useMemo(() => parseFilterConditions(filter), [filter]);

  const { data: profiles } = useQuery({
    ...contextGroupFieldProfilesQuery(datastore, datasourceId),
    enabled: !!datasourceId && conditions.length > 0,
  });

  const fieldOptions = useMemo(() => {
    const paths = (profiles?.fields ?? []).map(f => f.path);
    // Keep fields referenced by saved conditions selectable even when they no
    // longer show up in the sampled profiles.
    for (const condition of conditions) {
      if (condition.field && !paths.includes(condition.field)) {
        paths.push(condition.field);
      }
    }
    return paths;
  }, [profiles, conditions]);

  const setConditions = (next: FilterCondition[]) => {
    onChange(next.length > 0 ? JSON.stringify(next) : undefined);
  };

  const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
    setConditions(
      conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  };

  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => (
        <div
          key={index}
          className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2"
        >
          <div className="flex items-center gap-1.5">
            <Select
              value={condition.field}
              onValueChange={value => updateCondition(index, { field: value })}
            >
              <SelectTrigger
                className="h-8 flex-1 font-mono text-xs"
                aria-label={`Filter ${index + 1} field for ${datasourceName}`}
              >
                <SelectValue placeholder="Select field" />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions.map(path => (
                  <SelectItem
                    key={path}
                    value={path}
                    className="font-mono text-xs"
                  >
                    {path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() =>
                setConditions(conditions.filter((_, i) => i !== index))
              }
              aria-label={`Remove filter ${index + 1} for ${datasourceName}`}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Select
              value={condition.operator}
              onValueChange={value =>
                updateCondition(index, { operator: value as FilterOperator })
              }
            >
              <SelectTrigger
                className="h-8 w-36 shrink-0 text-xs"
                aria-label={`Filter ${index + 1} operator for ${datasourceName}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map(op => (
                  <SelectItem
                    key={op.value}
                    value={op.value}
                    className="text-xs"
                  >
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={condition.value}
              onChange={e => updateCondition(index, { value: e.target.value })}
              placeholder="Value"
              aria-label={`Filter ${index + 1} value for ${datasourceName}`}
              className="h-8 flex-1 text-xs"
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant={conditions.length > 0 ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setConditions([...conditions, { ...NEW_CONDITION }])}
          disabled={!datasourceId}
          aria-label={`Add filter for ${datasourceName}`}
        >
          <ListFilter className="size-4" />
          Add filter
        </Button>
      </div>
    </div>
  );
}
