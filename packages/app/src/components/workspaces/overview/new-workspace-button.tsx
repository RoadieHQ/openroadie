import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@roadiehq/ui/tooltip';
import { COMING_SOON_LABEL } from '../workspace-picker';

/**
 * Creating a workspace is gated by `workspace-creation`. While it is off the
 * button is `aria-disabled` rather than `disabled`, so it keeps its focus stop
 * and can still explain itself — a `disabled` button fires no pointer or focus
 * events and so could show no tooltip at all.
 */
export function NewWorkspaceButton({
  enabled,
  label = 'New workspace',
  onClick,
}: {
  enabled: boolean;
  label?: string;
  onClick: () => void;
}) {
  if (enabled) {
    return (
      <Button type="button" onClick={onClick}>
        <Plus className="size-4" />
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-disabled
          onClick={event => event.preventDefault()}
          className="cursor-not-allowed opacity-50"
        >
          <Plus className="size-4" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{COMING_SOON_LABEL}</TooltipContent>
    </Tooltip>
  );
}
