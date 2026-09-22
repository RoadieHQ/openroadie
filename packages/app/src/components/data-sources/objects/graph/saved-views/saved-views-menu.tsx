import { useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import type { SavedGraphView } from './saved-view-schema';
import { SaveViewDialog } from './save-view-dialog';
import { savedGraphViewIconForKey } from './saved-view-icons';

/**
 * The header's saved-views control: pick a view to apply it, save the
 * current one, or delete stale ones (behind a confirmation).
 */
export function SavedViewsMenu({
  views,
  onApply,
  onSaveCurrent,
  onDelete,
}: {
  views: SavedGraphView[];
  onApply: (view: SavedGraphView) => void;
  /** Called with the validated name; the caller captures the snapshot. */
  onSaveCurrent: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedGraphView | null>(
    null,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            aria-label="Saved graph views"
            data-testid="saved-views-trigger"
          >
            <Bookmark className="size-3.5" />
            Views
            {views.length > 0 && (
              <span className="tabular-nums">({views.length})</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {views.length > 0 && (
            <>
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              {views.map(view => {
                const ViewIcon = savedGraphViewIconForKey(view.iconKey);
                return (
                  <DropdownMenuItem
                    key={view.id}
                    className="group flex items-center gap-2"
                    onSelect={() => onApply(view)}
                  >
                    <ViewIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 shrink-0 p-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive"
                      aria-label={`Delete saved view ${view.name}`}
                      onClick={event => {
                        // Deleting must not also apply the view.
                        event.preventDefault();
                        event.stopPropagation();
                        setPendingDelete(view);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
            <BookmarkPlus className="size-4" />
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        existingNames={views.map(view => view.name)}
        onSave={onSaveCurrent}
      />

      <ConfirmationDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        contentText="The saved view is removed from this browser. The graph itself is unaffected."
        isDelete
        confirmButtonText="Delete view"
        onConfirm={() => {
          if (pendingDelete) {
            onDelete(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
