import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { PREVIEW_ITEM_LIMIT } from '../../../api/workflow/workflow-client';
import { JsonTreeView } from '../../common/json-tree-view';

export interface SchemaViewerProps {
  output?: unknown[];
  maxHeight?: number | string;
  fillHeight?: boolean;
  isPreviewRun?: boolean;
  toolbarLeft?: React.ReactNode;
}

/**
 * Paginated JSON viewer for an array of output items: item navigation + count
 * on top of the shared `JsonTreeView` tree/copy/collapse controls.
 */
export function SchemaViewer({
  output,
  maxHeight = 400,
  fillHeight = false,
  isPreviewRun = false,
  toolbarLeft,
}: SchemaViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const outputCount = Array.isArray(output) ? output.length : 0;
  const currentItem = output?.at(currentIndex);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < outputCount - 1;

  useEffect(() => {
    if (currentIndex >= outputCount) {
      setCurrentIndex(0);
    }
  }, [currentIndex, outputCount]);

  if (outputCount === 0) {
    return null;
  }

  return (
    <JsonTreeView
      value={currentItem ?? {}}
      maxHeight={maxHeight}
      fillHeight={fillHeight}
      toolbarLeft={
        <>
          {toolbarLeft}
          <div className="flex items-center gap-1">
            {outputCount > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentIndex(i => i - 1)}
                  disabled={!canGoPrev}
                  className="size-5"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[50px] text-center text-xs font-medium text-muted-foreground">
                  {currentIndex + 1} / {outputCount}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentIndex(i => i + 1)}
                  disabled={!canGoNext}
                  className="size-5"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </>
            )}
            <span className="text-xs font-medium text-muted-foreground">
              {isPreviewRun && outputCount >= PREVIEW_ITEM_LIMIT
                ? `${PREVIEW_ITEM_LIMIT}+ items (dry run limit)`
                : `${outputCount} item${outputCount !== 1 ? 's' : ''}`}
            </span>
          </div>
        </>
      }
    />
  );
}
