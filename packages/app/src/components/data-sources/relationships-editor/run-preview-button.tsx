import { Play, RefreshCw } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';

/**
 * The run/refresh control for an integration-backed preview: a Play icon before
 * the first run, a Refresh icon afterwards, a spinner while running. Shared by
 * the Lookup config and the Materialized Relationships header so the two stay
 * identical.
 *
 * Enabled once the request is runnable (integration + path + source/target/
 * relationship) — it does NOT wait for a response-match expression, so you can
 * run to fetch the response and then pick the response field from it. When the
 * run is blocked, the reason rides the (disabled) button as a tooltip.
 */
export function RunPreviewButton({
  editor,
}: {
  editor: RelationshipRuleEditorState;
}) {
  const hasRun = !!editor.previewResult;
  const label = hasRun ? 'Re-run preview' : 'Run preview';
  const disabled = !editor.canRunPreview || editor.previewLoading;
  // Only show a reason when it's the inputs (not an in-flight run) blocking it.
  const reason = !editor.canRunPreview ? editor.previewBlockedReason : null;

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        void editor.handleIntegrationPreview();
      }}
    >
      {editor.previewLoading ? (
        <Spinner className="size-3.5" />
      ) : hasRun ? (
        <RefreshCw className="size-3.5" />
      ) : (
        <Play className="size-3.5" />
      )}
    </Button>
  );

  if (!reason) {
    return button;
  }

  // A span wraps the disabled button so the tooltip still opens on hover.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
