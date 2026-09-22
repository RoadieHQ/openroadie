import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@roadiehq/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

export interface EditorActionMenuItem {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Hint when clickable, or why it's disabled. */
  tooltip?: string;
  /** Red styling for destructive actions (e.g. Delete). */
  destructive?: boolean;
  /** Render a separator above this item. */
  separatorBefore?: boolean;
}

export interface EditorActionsMenuProps {
  items: EditorActionMenuItem[];
  label?: string;
  testId?: string;
}

/**
 * Disabled DropdownMenuItems don't receive pointer events, so the tooltip
 * trigger sits on a wrapping element rather than the item itself.
 */
function MenuItemTooltip({
  content,
  children,
}: {
  content?: string;
  children: React.ReactNode;
}) {
  if (!content) {
    return <>{children}</>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{children}</div>
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The shared "⋯" overflow menu for the pipeline editors' headers — a trigger
 * button plus a list of (optionally disabled / tooltipped / destructive) items.
 * Used by the data-source editor (Run once / Enable-Disable / Inspector /
 * Delete) and the actions editor (Enable-Disable / History / Duplicate /
 * Delete).
 */
export function EditorActionsMenu({
  items,
  label = 'Actions',
  testId,
}: EditorActionsMenuProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={label}
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            data-testid={testId}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map(item => (
            <React.Fragment key={item.label}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              <MenuItemTooltip content={item.tooltip}>
                <DropdownMenuItem
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  className={
                    item.destructive
                      ? 'text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive'
                      : undefined
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
                </DropdownMenuItem>
              </MenuItemTooltip>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
