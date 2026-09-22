import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Card } from '@roadiehq/ui/card';
import { Checkbox } from '@roadiehq/ui/checkbox';
import { Input } from '@roadiehq/ui/input';
import { Label } from '@roadiehq/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { cn } from '@roadiehq/ui/utils';
import { FieldPicker } from '../../../common';
import { useDatastore } from '../../../../api';
import { contextGroupFieldProfilesQuery } from '../../../../api/queries';
import type {
  ContextGroupViewSchema,
  ContextGroupViewSource,
} from '../../../../api/datastore/datastore-client';
import { autoLabel } from '../projection-utils';
import { memberAccess } from './compile-template';
import {
  VIEW_FORMATS,
  type ViewField,
  type ViewFormat,
  type ViewRelated,
  type ViewSource,
  type ViewSpec,
} from './types';

const FORMAT_LABELS: Record<ViewFormat, string> = {
  json: 'JSON',
  markdown: 'Markdown',
  text: 'Plain text',
};

const FORMAT_HINTS: Record<ViewFormat, string> = {
  json: 'Structured — best when the agent looks fields up by name.',
  markdown: 'Prose-shaped — best when the agent summarises or quotes.',
  text: 'Terse key/value lines. The cheapest of the three.',
};

/** Same set, ignoring order — the presets are sets, not sequences. */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(value => b.includes(value));
}

function fieldsOf(source: ViewSource): string[] {
  return source.fields.map(field => field.path);
}

function SelectedField({
  field,
  siblings,
  onChange,
  onRemove,
}: {
  field: ViewField;
  siblings: ViewField[];
  onChange: (next: ViewField) => void;
  onRemove: () => void;
}) {
  const fallback = autoLabel(
    field.path,
    siblings.map(f => f.path),
  );
  const renamed = Boolean(field.label?.trim());
  return (
    <span className="inline-flex max-w-full items-center rounded-sm border border-border bg-muted/40 pr-0.5 font-mono text-2xs">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={`${field.path}${renamed ? ` → ${field.label}` : ''}`}
            aria-label={`Rename ${field.path} in the output`}
            className="h-auto min-w-0 gap-0 rounded-sm px-1.5 py-0.5 font-mono text-2xs font-normal focus-visible:ring-1 focus-visible:ring-offset-0"
          >
            <span className="truncate text-muted-foreground">{field.path}</span>
            {renamed && (
              <span className="truncate text-foreground">
                {' → '}
                {field.label}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-1.5">
          <Label htmlFor={`rename-${field.path}`} className="text-xs">
            Output name
          </Label>
          <Input
            id={`rename-${field.path}`}
            value={field.label ?? ''}
            onChange={e =>
              onChange({ ...field, label: e.target.value || undefined })
            }
            placeholder={fallback}
            aria-label={`Output name for ${field.path}`}
            className="h-7 text-xs"
          />
          <p className="text-2xs text-muted-foreground">
            The key this field is emitted under. Defaults to{' '}
            <span className="font-mono">{fallback}</span>.
          </p>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${field.path}`}
        onClick={onRemove}
        className="size-4 rounded-sm text-muted-foreground hover:text-destructive focus-visible:ring-1 focus-visible:ring-offset-0 [&_svg]:size-3"
      >
        <X />
      </Button>
    </span>
  );
}

function FieldList({
  fields,
  available,
  emptyLabel,
  onChange,
}: {
  fields: ViewField[];
  available: string[];
  emptyLabel: string;
  onChange: (next: ViewField[]) => void;
}) {
  const unpicked = useMemo(
    () =>
      available
        .filter(path => !fields.some(field => field.path === path))
        .map(path => ({ name: path })),
    [available, fields],
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      )}
      {fields.map((field, index) => (
        <SelectedField
          key={field.path}
          field={field}
          siblings={fields}
          onChange={next =>
            onChange(fields.map((f, i) => (i === index ? next : f)))
          }
          onRemove={() => onChange(fields.filter((_, i) => i !== index))}
        />
      ))}
      <FieldPicker
        fields={unpicked}
        onPick={path => onChange([...fields, { path }])}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-2xs"
            disabled={unpicked.length === 0}
          >
            <Plus className="size-3" />
            Add field
          </Button>
        }
        triggerLabel="Add field"
      />
    </div>
  );
}

/** One relationship type a member can expand into. Field selection is only
 *  offered when the type resolves to a single target data source — otherwise
 *  the objects come from different shapes and there is no one field tree. */
function RelatedRow({
  available,
  selected,
  onChange,
}: {
  available: ContextGroupViewSource['relationshipTypes'][number];
  selected?: ViewRelated;
  onChange: (next: ViewRelated | undefined) => void;
}) {
  const datastore = useDatastore();
  const targetDatasourceId =
    available.targetDatasourceIds.length === 1
      ? available.targetDatasourceIds[0]
      : undefined;

  const { data: profiles } = useQuery({
    ...contextGroupFieldProfilesQuery(datastore, targetDatasourceId ?? ''),
    enabled: Boolean(selected && targetDatasourceId),
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`related-${available.type}`}
          checked={Boolean(selected)}
          onCheckedChange={checked =>
            onChange(
              checked === true
                ? { type: available.type, fields: [] }
                : undefined,
            )
          }
        />
        <Label
          htmlFor={`related-${available.type}`}
          className="cursor-pointer text-xs font-normal"
        >
          <span className="font-mono">{available.type}</span>
        </Label>
        <Badge variant="secondary" className="h-4 px-1 text-2xs">
          {available.count}
        </Badge>
      </div>
      {selected && (
        <div className="space-y-1.5 border-l border-border pl-4">
          {targetDatasourceId ? (
            <FieldList
              fields={selected.fields}
              available={(profiles?.fields ?? []).map(field => field.path)}
              emptyLabel="Whole object."
              onChange={fields => onChange({ ...selected, fields })}
            />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Points at more than one data source — the whole object is
              included.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  selected,
  onChange,
}: {
  source: ContextGroupViewSource;
  selected?: ViewSource;
  onChange: (next: ViewSource | undefined) => void;
}) {
  const availablePaths = useMemo(
    () => source.fields.map(field => field.path),
    [source.fields],
  );

  const presets: { id: string; label: string; paths: string[] }[] = [
    {
      id: 'identifiers',
      label: 'Identifiers',
      paths: source.presets.identifiers,
    },
    { id: 'essentials', label: 'Essentials', paths: source.presets.essentials },
    { id: 'all', label: 'All fields', paths: [] },
  ];

  const activePreset = selected
    ? presets.find(preset =>
        preset.id === 'all'
          ? selected.fields.length === 0
          : preset.paths.length > 0 &&
            sameSet(preset.paths, fieldsOf(selected)),
      )?.id
    : undefined;

  return (
    <Card variant="flat" className="space-y-2 p-2.5">
      <div className="flex items-start gap-2">
        <Checkbox
          id={`source-${source.key}`}
          checked={Boolean(selected)}
          className="mt-0.5"
          onCheckedChange={checked =>
            onChange(
              checked === true
                ? {
                    key: source.key,
                    label: source.label,
                    fields: source.presets.essentials.map(path => ({ path })),
                    related: [],
                  }
                : undefined,
            )
          }
        />
        {/* Two blocks, not one label: `Label` lays its children out inline, so
            the name and the document key ran together on one line. */}
        <div className="min-w-0 flex-1">
          <Label
            htmlFor={`source-${source.key}`}
            className="cursor-pointer text-sm font-medium"
          >
            {source.label}
          </Label>
          <p
            className="truncate font-mono text-2xs text-muted-foreground"
            title={memberAccess(source.key)}
          >
            {memberAccess(source.key)}
          </p>
        </div>
      </div>

      {selected && (
        <div className="space-y-2 pl-6">
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {presets.map(preset => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant={activePreset === preset.id ? 'secondary' : 'ghost'}
                  className={cn(
                    'h-6 px-2 text-xs',
                    activePreset === preset.id && 'ring-1 ring-border',
                  )}
                  disabled={preset.id !== 'all' && preset.paths.length === 0}
                  onClick={() =>
                    onChange({
                      ...selected,
                      fields: preset.paths.map(path => ({ path })),
                    })
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <FieldList
              fields={selected.fields}
              available={availablePaths}
              emptyLabel="Whole object — every field is included."
              onChange={fields => onChange({ ...selected, fields })}
            />
          </div>

          {source.relationshipTypes.length > 0 && (
            <div className="space-y-1">
              <p className="text-2xs font-medium text-muted-foreground">
                Related objects
              </p>
              {source.relationshipTypes.map(relationshipType => (
                <RelatedRow
                  key={relationshipType.type}
                  available={relationshipType}
                  selected={selected.related.find(
                    related => related.type === relationshipType.type,
                  )}
                  onChange={next =>
                    onChange({
                      ...selected,
                      related: next
                        ? [
                            ...selected.related.filter(
                              related => related.type !== next.type,
                            ),
                            next,
                          ].sort((a, b) => a.type.localeCompare(b.type))
                        : selected.related.filter(
                            related => related.type !== relationshipType.type,
                          ),
                    })
                  }
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Label
              htmlFor={`limit-${source.key}`}
              className="text-2xs font-normal text-muted-foreground"
            >
              First
            </Label>
            <Input
              id={`limit-${source.key}`}
              type="number"
              min={1}
              value={selected.limit ?? ''}
              placeholder="all"
              onChange={e => {
                const parsed = Number.parseInt(e.target.value, 10);
                onChange({
                  ...selected,
                  limit:
                    Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
                });
              }}
              className="h-6 w-16 text-2xs"
            />
            <span className="text-2xs text-muted-foreground">objects</span>
          </div>
        </div>
      )}
    </Card>
  );
}

export interface ViewBuilderProps {
  schema?: ContextGroupViewSchema;
  loading?: boolean;
  spec: ViewSpec;
  onChange: (next: ViewSpec) => void;
}

/**
 * Assemble a view from the rule's own data sources: which sources are in
 * the view, which of their fields, which relationships to expand, and what the
 * output looks like. The result compiles to the Liquid template that is
 * actually stored — the template is the artifact, this is the interface.
 */
export function ViewBuilder({
  schema,
  loading,
  spec,
  onChange,
}: ViewBuilderProps) {
  const setSource = (key: string, next: ViewSource | undefined) => {
    const byKey = new Map(spec.sources.map(source => [source.key, source]));
    if (next) {
      byKey.set(key, next);
    } else {
      byKey.delete(key);
    }
    // Rebuild in schema order so the output key order doesn't depend on the
    // order the user ticked the boxes.
    onChange({
      ...spec,
      sources: (schema?.sources ?? [])
        .map(source => byKey.get(source.key))
        .filter((source): source is ViewSource => Boolean(source)),
    });
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!schema || schema.sources.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This context group has no materialized objects yet, so there are no
        fields to pick from. Materialize it from the group settings tab, or
        switch to the raw template below.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="view-format" className="text-xs font-medium">
          Output format
        </Label>
        <Select
          value={spec.format}
          onValueChange={value =>
            onChange({ ...spec, format: value as ViewFormat })
          }
        >
          <SelectTrigger id="view-format" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_FORMATS.map(format => (
              <SelectItem key={format} value={format}>
                {FORMAT_LABELS[`${format}`]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {FORMAT_HINTS[`${spec.format}`]}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Data sources</p>
        {schema.sources.map(source => (
          <SourceCard
            key={source.key}
            source={source}
            selected={spec.sources.find(
              selected => selected.key === source.key,
            )}
            onChange={next => setSource(source.key, next)}
          />
        ))}
      </div>
    </div>
  );
}
