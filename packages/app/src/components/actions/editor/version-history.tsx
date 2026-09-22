import { X, ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Badge } from '@roadiehq/ui/badge';
import { cn } from '@roadiehq/ui/utils';
import type { ActionVersion } from '../types';

export function VersionHistory({
  show,
  onClose,
  loading,
  versions,
  currentVersion,
  viewingVersion,
  onView,
}: {
  show: boolean;
  onClose: () => void;
  loading: boolean;
  versions: ActionVersion[];
  currentVersion?: number;
  viewingVersion?: number;
  onView: (version: ActionVersion) => void;
}) {
  return (
    <>
      <div
        className={cn(
          'motion-panel fixed inset-y-0 right-0 z-40 flex w-80 flex-col border-l border-border bg-card shadow-lg',
          show ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Version History</h3>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="motion-icon-spin size-5 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No version history
            </div>
          ) : (
            <div className="divide-y divide-border">
              {versions.map(version => (
                <Button
                  key={version.id}
                  variant="ghost"
                  className={cn(
                    'flex h-auto w-full items-center gap-3 rounded-none px-4 py-3 text-left',
                    version.version === currentVersion && 'bg-primary/5',
                    viewingVersion === version.version &&
                      'ring-2 ring-primary ring-inset',
                  )}
                  onClick={() => onView(version)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        v{version.version}
                      </span>
                      {version.version === currentVersion && (
                        <Badge variant="default" className="text-[10px]">
                          Current
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {version.name} · {version.slug}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {show && (
        <div
          role="presentation"
          className="fixed inset-0 z-30 bg-black/20"
          onClick={onClose}
        />
      )}
    </>
  );
}
