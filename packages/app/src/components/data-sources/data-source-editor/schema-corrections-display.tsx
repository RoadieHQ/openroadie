import React from 'react';
import { Sparkles, Check } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import type { SchemaCorrection } from '@roadiehq/catalog-datastore-common';

export interface SchemaCorrectionsDisplayProps {
  corrections: SchemaCorrection[];
  onAccept: () => void;
  accepted: boolean;
}

export function SchemaCorrectionsDisplay({
  corrections,
  onAccept,
  accepted,
}: SchemaCorrectionsDisplayProps) {
  if (corrections.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'mb-4 rounded-md border p-4',
        accepted
          ? 'border-success/30 bg-success/[0.08]'
          : 'border-warning/30 bg-warning/10',
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles
            className={cn('size-4', accepted ? 'text-success' : 'text-warning')}
          />
          <span
            className={cn(
              'text-sm font-semibold',
              accepted ? 'text-success' : 'text-warning',
            )}
          >
            {accepted ? 'Schema Updated' : 'Schema Corrections Available'}
          </span>
        </div>
        {!accepted && (
          <Button
            variant="outline"
            size="sm"
            onClick={e => {
              e.stopPropagation();
              onAccept();
            }}
            className="h-6 border-warning/50 px-2 py-0.5 text-xs text-warning"
          >
            <Check className="mr-1 size-3.5" />
            Apply & Save
          </Button>
        )}
      </div>
      <ul className="m-0 pl-5">
        {corrections.map((c, i) => (
          <li key={`${c.field}-${i}`} className="mb-0.5 last:mb-0">
            <span className="font-mono text-xs text-muted-foreground">
              {c.type === 'type_widened' ? (
                <>
                  <strong>{c.field}</strong>: type{' '}
                  <span className="line-through">{c.before}</span> &rarr;{' '}
                  {c.after}
                </>
              ) : (
                <>
                  <strong>{c.field}</strong>: added enum values {c.after}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
