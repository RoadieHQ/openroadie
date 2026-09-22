import React, { useEffect, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { CopyButton } from '@roadiehq/ui/copy-button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { getIsDark, subscribeTheme } from '../../../theme';
import ReactJsonModule from 'react-json-view';

/**
 * react-json-view isn't the shared `Editor` (which handles theme internally),
 * so it needs the current light/dark state to pick a palette. Small local
 * subscription over the app's theme store.
 */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? getIsDark() : false,
  );
  useEffect(() => {
    setIsDark(getIsDark());
    return subscribeTheme(() => setIsDark(getIsDark()));
  }, []);
  return isDark;
}

// Some bundler/interop configs wrap the CJS default in another `.default`.
// The export is an object, so it's assignable to a shape with an optional
// `default` — a single cast (no `unknown` bridge) is enough to probe for it.
const ReactJson =
  (ReactJsonModule as { default?: typeof ReactJsonModule }).default ??
  ReactJsonModule;

export interface JsonTreeViewProps {
  /** The JSON value to render as an interactive, collapsible tree. */
  value: unknown;
  maxHeight?: number | string;
  fillHeight?: boolean;
  /** Controls rendered at the left of the toolbar (e.g. item pagination). */
  toolbarLeft?: React.ReactNode;
}

/**
 * Interactive JSON tree with expand-all / collapse-all and copy controls.
 * The shared primitive behind `SchemaViewer` (which layers item pagination on
 * top) and the actions test-runner's per-step result view.
 */
export function JsonTreeView({
  value,
  maxHeight = 400,
  fillHeight = false,
  toolbarLeft,
}: JsonTreeViewProps) {
  const isDark = useIsDark();
  const [collapsedDepth, setCollapsedDepth] = useState<number | boolean>(1);

  // Reset to the default depth whenever a different value is shown.
  useEffect(() => {
    setCollapsedDepth(1);
  }, [value]);

  const maxHeightStyle =
    typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

  return (
    <div className={fillHeight ? 'flex h-full min-h-0 flex-col' : undefined}>
      <div className="flex items-center justify-between bg-white/[0.02] py-1 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2">{toolbarLeft}</div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setCollapsedDepth(prev => (prev === false ? 1 : false))
                }
                // The tooltip describes the button, it doesn't name it: Radix
                // wires TooltipContent as aria-describedby, so an icon-only
                // trigger still needs its own label (axe `button-name`).
                aria-label={
                  collapsedDepth === false ? 'Collapse all' : 'Expand all'
                }
                className="size-6 text-muted-foreground"
              >
                {collapsedDepth === false ? (
                  <ChevronsDownUp className="size-3.5" />
                ) : (
                  <ChevronsUpDown className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {collapsedDepth === false ? 'Collapse all' : 'Expand all'}
            </TooltipContent>
          </Tooltip>
          <CopyButton value={() => JSON.stringify(value, null, 2)} />
        </div>
      </div>

      <div
        className={cn(
          'nowheel overflow-auto rounded border border-border bg-muted/50 p-2 dark:bg-black/30',
          fillHeight && 'min-h-0 flex-1',
        )}
        style={fillHeight ? undefined : { maxHeight: maxHeightStyle }}
      >
        <ReactJson
          src={(value ?? {}) as object}
          name={false}
          theme={isDark ? 'chalk' : 'rjv-default'}
          displayDataTypes={false}
          displayObjectSize={false}
          collapsed={collapsedDepth}
          collapseStringsAfterLength={100}
          groupArraysAfterLength={25}
          enableClipboard={false}
          style={{ fontSize: '0.775rem' }}
        />
      </div>
    </div>
  );
}
