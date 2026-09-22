import { useMemo, useState } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { useCopyToClipboard } from '@roadiehq/ui/copy-button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@roadiehq/ui/collapsible';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { DetailSection } from '../../../common';
import { JsonTreeView } from '../../../common/json-tree-view';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const FIELD_PRIORITY = [
  'name',
  'title',
  'display_name',
  'email',
  'login',
  'slug',
  'role',
  'entity_type',
  'state',
] as const;

const FIELD_PREVIEW_COUNT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatDate(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatFieldValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return String(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

function orderedEntries(object: unknown): [string, unknown][] {
  if (!isRecord(object)) {
    return [];
  }

  const priorityRank = new Map<string, number>(
    FIELD_PRIORITY.map((field, index): [string, number] => [field, index]),
  );

  return Object.entries(object).sort(([left], [right]) => {
    const leftPriority = priorityRank.get(left);
    const rightPriority = priorityRank.get(right);
    if (leftPriority !== undefined || rightPriority !== undefined) {
      return (
        (leftPriority ?? Number.POSITIVE_INFINITY) -
        (rightPriority ?? Number.POSITIVE_INFINITY)
      );
    }
    return left.localeCompare(right);
  });
}

function CopyableValue({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = () => void copy(value);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      title={value}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      className="group grid h-auto max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center justify-start gap-2 rounded-sm p-0 text-left font-mono text-xs font-normal text-foreground shadow-none hover:bg-transparent hover:text-primary"
    >
      <span className="min-w-0 truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-success opacity-100" />
      ) : (
        <Copy className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      )}
    </Button>
  );
}

function DataFieldRow({ name, value }: { name: string; value: unknown }) {
  if (typeof value === 'object' && value !== null) {
    return (
      <div className="grid min-w-0 gap-1.5">
        <dt className="font-mono text-xs break-all text-muted-foreground">
          {name}
        </dt>
        <dd className="min-w-0">
          <TooltipProvider delayDuration={300}>
            <JsonTreeView value={value} maxHeight={320} />
          </TooltipProvider>
        </dd>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt className="min-w-0 truncate font-mono text-xs text-muted-foreground">
        {name}
      </dt>
      <dd className="min-w-0">
        <CopyableValue label={name} value={formatFieldValue(value)} />
      </dd>
    </div>
  );
}

export function ObjectMetadataPanel({
  object,
  createdAt,
  updatedAt,
}: {
  object: unknown;
  createdAt?: string;
  updatedAt?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = useMemo(() => orderedEntries(object), [object]);
  const visibleEntries = entries.slice(0, FIELD_PREVIEW_COUNT);
  const hiddenEntries = entries.slice(FIELD_PREVIEW_COUNT);
  const created = createdAt ? formatDate(createdAt) : null;
  const updated = updatedAt ? formatDate(updatedAt) : null;
  const hiddenPreview = hiddenEntries
    .slice(0, 3)
    .map(([key]) => key)
    .join(', ');
  const hiddenSuffix =
    hiddenEntries.length > 3 && hiddenPreview
      ? `${hiddenPreview}...`
      : hiddenPreview;
  const footerItems = [
    created ? ['Created', created] : null,
    updated ? ['Updated', updated] : null,
  ].filter((item): item is string[] => item !== null);

  return (
    <DetailSection title="Data" count={entries.length}>
      <div className="rounded-md border border-divider bg-surface px-4 py-3">
        {entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No object fields available.
          </div>
        ) : (
          <dl className="grid gap-3">
            {visibleEntries.map(([key, value]) => (
              <DataFieldRow key={key} name={key} value={value} />
            ))}
          </dl>
        )}
        {hiddenEntries.length > 0 && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleContent>
              <dl className="mt-3 grid gap-3">
                {hiddenEntries.map(([key, value]) => (
                  <DataFieldRow key={key} name={key} value={value} />
                ))}
              </dl>
            </CollapsibleContent>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    'motion-transform-standard size-3.5',
                    expanded && 'rotate-90',
                  )}
                />
                {expanded
                  ? `Hide ${hiddenEntries.length.toLocaleString()} fields`
                  : `Show ${hiddenEntries.length.toLocaleString()} more fields${
                      hiddenSuffix ? ` (${hiddenSuffix})` : ''
                    }`}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        )}
        {footerItems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-divider pt-3 text-xs text-muted-foreground">
            {footerItems.map(([label, value]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span>{label}</span>
                <span className="text-foreground tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </DetailSection>
  );
}
