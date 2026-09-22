import { lazy, Suspense, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@roadiehq/ui/spinner';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { DetailDrawer } from '../../common';
import { useDatastore } from '../../../api';
import { workspaceQueryKey } from '../../../api/workspace-scope';
import { countTokenRange } from './token-counter';

// Reuse the JSON viewer lazily so react-json-view only loads when the drawer
// is opened.
const SchemaViewer = lazy(() =>
  import('../../data-sources/data-source-editor/schema-viewer').then(
    module => ({ default: module.SchemaViewer }),
  ),
);

/**
 * Slideout showing the real materialized bundle for a group — exactly what the
 * `get-context-bundle` MCP tool returns to an agent (projected data grouped by
 * datasource, annotations, and external-relation identifiers).
 */
export function FullBundleDrawer({
  group,
  onClose,
}: {
  group: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const datastore = useDatastore();
  const open = !!group;

  const { data, isLoading, error } = useQuery({
    queryKey: workspaceQueryKey('contextGroups', 'bundle', group?.id),
    queryFn: () => datastore.getContextGroupBundle(group?.id ?? ''),
    enabled: open,
  });

  const tokens = useMemo(
    () => (data ? countTokenRange(JSON.stringify(data)).min : 0),
    [data],
  );

  return (
    <DetailDrawer
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      modal
      title="Full bundle"
      subtitle={group?.name}
      size="xl"
      loading={isLoading}
      error={
        error
          ? error instanceof Error
            ? error.message
            : 'Failed to load bundle'
          : undefined
      }
    >
      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border bg-card p-2.5 text-sm">
            <span className="text-muted-foreground">
              Bundle size (this group)
            </span>
            <span className="font-medium tabular-nums">
              ~{tokens.toLocaleString()} tokens
            </span>
          </div>
          <Suspense
            fallback={
              <div className="flex min-h-24 items-center justify-center">
                <Spinner size={16} />
              </div>
            }
          >
            <TooltipProvider>
              <SchemaViewer output={[data]} maxHeight={640} />
            </TooltipProvider>
          </Suspense>
        </div>
      )}
    </DetailDrawer>
  );
}
