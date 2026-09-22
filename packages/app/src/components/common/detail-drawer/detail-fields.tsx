import type { ReactNode } from 'react';
import { DefinitionValue } from '@roadiehq/ui/definition-list';
import { cn } from '@roadiehq/ui/utils';

export interface DetailField {
  /** Caption + React key, e.g. "Last run". */
  label: string;
  /** Value; empty (`null`/`undefined`/`''`) renders an em dash. */
  value?: ReactNode;
}

export interface DetailFieldsProps {
  fields: DetailField[];
  className?: string;
}

/**
 * Key/value metadata for a detail drawer, laid out as a two-column grid inside
 * a single bordered card (the same surface as the stat tiles), each label
 * stacked above its value. Renders a semantic `<dl>` underneath.
 *
 * Distinct from `@roadiehq/ui`'s `DefinitionList`, which is the label-beside-value
 * archetype on a bare surface; only the empty-value fallback is shared.
 */
export function DetailFields({ fields, className }: DetailFieldsProps) {
  if (fields.length === 0) {
    return null;
  }
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-divider bg-surface px-4 py-3',
        className,
      )}
    >
      {fields.map(field => (
        <div key={field.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="truncate text-xs text-muted-foreground">
            {field.label}
          </dt>
          <dd className="min-w-0 truncate text-sm text-surface-foreground">
            <DefinitionValue>{field.value}</DefinitionValue>
          </dd>
        </div>
      ))}
    </dl>
  );
}
