import React, { useState } from 'react';
import { EntityEditorShell } from '../entity-editor-shell';
import { useResizablePanel } from './use-resizable-panel';

// Defaults preserved from the data-source editor so its saved panel width (keyed
// on the storage key below) and geometry are unchanged. Callers may override.
export const PIPELINE_PANEL_MIN_WIDTH = 320;
export const PIPELINE_PANEL_DEFAULT_WIDTH = 620;
export const PIPELINE_PANEL_MAX_WIDTH = 900;
export const PIPELINE_MAIN_CONTENT_MIN_WIDTH = 360;
export const PIPELINE_PANEL_WIDTH_STORAGE_KEY =
  'data-source-editor.details-panel-width';

export interface PipelineEditorLayoutProps {
  /** Header row (e.g. an EntityEditorHeader), rendered as the first shell child. */
  header: React.ReactNode;
  /** The vertical node column (step nodes + connectors). */
  canvas: React.ReactNode;
  /** Content of the right slide-in details panel. */
  detailsPanel?: React.ReactNode;
  /** Whether the details panel is expanded (open). */
  detailsPanelOpen: boolean;
  /**
   * Optional bottom drawer (e.g. an execution inspector). Receives the canvas
   * element so a portaled drawer can mount into it.
   */
  renderBottomDrawer?: (canvasEl: HTMLElement | null) => React.ReactNode;
  /** Extra shell children (dialogs, etc.), rendered after the canvas + drawer. */
  children?: React.ReactNode;
  shellClassName?: string;
  panelMinWidth?: number;
  panelMaxWidth?: number;
  panelDefaultWidth?: number;
  mainContentMinWidth?: number;
  panelWidthStorageKey?: string;
}

/**
 * The shared editor shell for node/pipeline editors: a header row, a scrolling
 * canvas column of step nodes, and a resizable right slide-in details panel,
 * with an optional bottom drawer. Model-agnostic — the canvas and panel content
 * are supplied by the caller. Used by the data-source editor (trigger → source →
 * transforms → sinks + execution inspector) and the actions editor.
 */
export function PipelineEditorLayout({
  header,
  canvas,
  detailsPanel,
  detailsPanelOpen,
  renderBottomDrawer,
  children,
  shellClassName = 'min-h-0 flex-1',
  panelMinWidth = PIPELINE_PANEL_MIN_WIDTH,
  panelMaxWidth = PIPELINE_PANEL_MAX_WIDTH,
  panelDefaultWidth = PIPELINE_PANEL_DEFAULT_WIDTH,
  mainContentMinWidth = PIPELINE_MAIN_CONTENT_MIN_WIDTH,
  panelWidthStorageKey = PIPELINE_PANEL_WIDTH_STORAGE_KEY,
}: PipelineEditorLayoutProps) {
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const { width: detailsPanelWidth, onResizeStart } = useResizablePanel({
    minWidth: panelMinWidth,
    maxWidth: panelMaxWidth,
    defaultWidth: panelDefaultWidth,
    mainContentMinWidth,
    storageKey: panelWidthStorageKey,
  });

  return (
    <EntityEditorShell className={shellClassName}>
      {header}

      <div
        ref={setCanvasEl}
        className="relative flex min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pt-0 sm:px-6 lg:px-8">
          <div className="min-h-0 min-w-0 flex-1 scrollbar-thin overflow-y-auto">
            <div className="w-full min-w-0 py-8">{canvas}</div>
          </div>
        </div>
        <div
          className="motion-panel-width relative min-h-0 shrink-0 overflow-hidden border-l border-border"
          style={{
            minWidth: detailsPanelOpen ? panelMinWidth : 0,
            width: detailsPanelOpen ? detailsPanelWidth : 0,
            borderColor: detailsPanelOpen ? undefined : 'transparent',
          }}
        >
          {/* Mouse-only drag affordance (no keyboard resize), so it carries
              no slider role/ARIA it doesn't implement. */}
          {detailsPanelOpen && (
            <div
              aria-hidden="true"
              onMouseDown={onResizeStart}
              className="absolute top-0 bottom-0 -left-[3px] z-[2] w-[6px] cursor-col-resize hover:bg-foreground/10"
            />
          )}
          <div
            className="motion-panel absolute inset-y-0 right-0 bg-card [--field-bg:var(--color-card)]"
            style={{
              width: detailsPanelWidth,
              transform: detailsPanelOpen
                ? 'translateX(0)'
                : 'translateX(100%)',
            }}
          >
            {detailsPanel}
          </div>
        </div>
      </div>

      {renderBottomDrawer?.(canvasEl)}
      {children}
    </EntityEditorShell>
  );
}
