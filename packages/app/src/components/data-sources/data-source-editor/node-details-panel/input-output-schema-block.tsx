import React, { Suspense, lazy } from 'react';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { DatastoreOutputTable } from './datastore-output-table';

const SchemaViewer = lazy(() =>
  import('../schema-viewer').then(module => ({
    default: module.SchemaViewer,
  })),
);

interface InputOutputSchemaBlockProps {
  tab: 'input' | 'output';
  onTabChange: (tab: 'input' | 'output') => void;
  inputItems?: unknown[];
  outputItems?: unknown[];
  outputAsTable?: boolean;
  /** Total items when `outputItems` is a capped sample; omit for dry-runs. */
  outputTotalCount?: number;
  outputSampleTruncated?: boolean;
}

export function InputOutputSchemaBlock({
  tab,
  onTabChange,
  inputItems = [],
  outputItems = [],
  outputAsTable = false,
  outputTotalCount,
  outputSampleTruncated = false,
}: InputOutputSchemaBlockProps) {
  const hasInput = inputItems.length > 0;
  const hasOutput = outputItems.length > 0;
  let activeTab: 'input' | 'output' = tab;
  if (!hasInput && hasOutput) {
    activeTab = 'output';
  } else if (!hasOutput && hasInput) {
    activeTab = 'input';
  }
  const selectedItems = activeTab === 'input' ? inputItems : outputItems;

  const tabToggle = (
    <div className="inline-flex overflow-hidden rounded border border-border">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onTabChange('input')}
        disabled={!hasInput}
        className={`motion-colors h-auto rounded-none border-r border-border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
          activeTab === 'input'
            ? 'bg-muted text-foreground'
            : 'bg-transparent text-muted-foreground hover:bg-muted/50'
        }`}
      >
        Input ({inputItems.length})
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onTabChange('output')}
        disabled={!hasOutput}
        className={`motion-colors h-auto rounded-none px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
          activeTab === 'output'
            ? 'bg-muted text-foreground'
            : 'bg-transparent text-muted-foreground hover:bg-muted/50'
        }`}
      >
        Output ({outputItems.length})
      </Button>
    </div>
  );

  const showTable = outputAsTable && activeTab === 'output';
  const showStandaloneToolbar = !showTable && selectedItems.length === 0;

  const outputTruncated =
    activeTab === 'output' &&
    hasOutput &&
    (outputSampleTruncated ||
      (outputTotalCount !== undefined &&
        outputTotalCount > outputItems.length));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {showStandaloneToolbar && (
        <div className="flex items-center border-b border-divider bg-white/[0.02] py-1">
          {tabToggle}
        </div>
      )}
      {outputTruncated && (
        <div className="px-1 py-1 text-xs text-muted-foreground">
          Showing {outputItems.length} of{' '}
          {(outputTotalCount ?? outputItems.length).toLocaleString()} items
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-1">
        {showTable ? (
          <DatastoreOutputTable
            rows={selectedItems}
            fillHeight
            toolbarLeft={tabToggle}
          />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full min-h-24 items-center justify-center">
                <Spinner size={16} />
              </div>
            }
          >
            <SchemaViewer
              output={selectedItems}
              isPreviewRun
              fillHeight
              toolbarLeft={tabToggle}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
