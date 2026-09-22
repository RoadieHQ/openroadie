import React, { useRef } from 'react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { Card } from '@roadiehq/ui/card';
import { Spinner } from '@roadiehq/ui/spinner';
import { GripVertical, Trash2, LayoutGrid } from 'lucide-react';
import { useDragPanel } from './use-drag-panel';
import { EditorModeSwitch } from './editor-mode-switch';
import type { EditorMode } from './editor-mode';

interface GraphToolbarProps {
  containerRef?: React.RefObject<HTMLElement | null>;
  mode: EditorMode;
  onModeChange: (next: EditorMode) => void;
  suggesting: boolean;
  clearingGeneratedRules?: boolean;
  hasGeneratedRules?: boolean;
  onClearGeneratedRules?: () => void;
  onAutoArrange?: () => void;
  extras?: React.ReactNode;
  children?: React.ReactNode;
}

export const GraphToolbar = React.memo(function GraphToolbar({
  containerRef,
  mode,
  onModeChange,
  suggesting,
  clearingGeneratedRules,
  hasGeneratedRules,
  onClearGeneratedRules,
  onAutoArrange,
  extras,
  children,
}: GraphToolbarProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { offset, onMouseDown, quadrant } = useDragPanel(
    panelRef,
    containerRef,
  );

  const childHorizontal =
    quadrant.horizontal === 'right' ? 'right-full mr-2' : 'left-full ml-2';
  const childVertical = quadrant.vertical === 'bottom' ? 'bottom-0' : 'top-0';

  return (
    <Card
      ref={panelRef}
      variant="floating"
      className="absolute top-[35%] left-4 z-float flex flex-col items-center gap-1 p-1.5"
      style={{
        transform: `translateY(-50%) translate(${offset.x}px, ${offset.y}px)`,
      }}
    >
      <div
        role="button"
        tabIndex={-1}
        aria-label="Drag toolbar"
        className="flex cursor-grab justify-center py-0.5 text-muted-foreground/50 hover:text-muted-foreground"
        onMouseDown={onMouseDown}
      >
        <GripVertical className="size-3.5" />
      </div>
      <EditorModeSwitch value={mode} onChange={onModeChange} />
      {extras}
      {suggesting && (
        <div className="flex items-center justify-center py-0.5">
          <Spinner className="size-4" />
        </div>
      )}
      <div className="mx-1 h-px w-full bg-border" />
      {onAutoArrange && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          onClick={onAutoArrange}
          title="Auto-arrange layout"
        >
          <LayoutGrid className="size-icon" />
        </Button>
      )}
      {onClearGeneratedRules && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          onClick={onClearGeneratedRules}
          disabled={clearingGeneratedRules || !hasGeneratedRules}
          title="Clear generated relationships"
        >
          {clearingGeneratedRules ? (
            <Spinner className="size-4" />
          ) : (
            <Trash2 className="size-icon" />
          )}
        </Button>
      )}
      {children && (
        <div
          className={cn(
            'absolute flex flex-col gap-2',
            childHorizontal,
            childVertical,
          )}
        >
          {children}
        </div>
      )}
    </Card>
  );
});
