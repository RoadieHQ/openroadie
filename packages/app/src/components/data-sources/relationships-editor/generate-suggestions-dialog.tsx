import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Checkbox } from '@roadiehq/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@roadiehq/ui/dialog';
import { Spinner } from '@roadiehq/ui/spinner';

export interface GenerateSuggestionsDataSource {
  id: string;
  label: string;
}

/**
 * Scoped Generate: pick two or more data sources and run suggestion
 * generation for the pairs between them only. Complements "Generate" (all
 * enabled sources) on tenants where a full run is slow or floods review —
 * the backend stales and persists suggestions only within the selected
 * scope, so out-of-scope suggestions are left untouched.
 */
export function GenerateSuggestionsDialog({
  open,
  onOpenChange,
  dataSources,
  generating,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataSources: GenerateSuggestionsDataSource[];
  generating: boolean;
  onGenerate: (datasourceIds: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open]);

  const sortedDataSources = useMemo(
    () => [...dataSources].sort((a, b) => a.label.localeCompare(b.label)),
    [dataSources],
  );

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const canGenerate = selectedIds.size >= 2 && !generating;

  const handleGenerate = async () => {
    // The suggestion mutation reports success/failure via toasts and never
    // rejects, so closing unconditionally is safe.
    await onGenerate([...selectedIds]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate between data sources</DialogTitle>
          <DialogDescription>
            Select two or more data sources. Suggestions are generated only for
            relationships between the selected sources; suggestions elsewhere
            are left untouched.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-1">
          {sortedDataSources.map(dataSource => (
            <label
              key={dataSource.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <Checkbox
                checked={selectedIds.has(dataSource.id)}
                onCheckedChange={() => toggle(dataSource.id)}
              />
              <span className="min-w-0 truncate">{dataSource.label}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleGenerate();
            }}
            disabled={!canGenerate}
            title={
              selectedIds.size < 2
                ? 'Select at least two data sources'
                : undefined
            }
          >
            {generating ? (
              <Spinner className="size-3" />
            ) : (
              <Sparkles className="size-3" />
            )}
            Generate ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
