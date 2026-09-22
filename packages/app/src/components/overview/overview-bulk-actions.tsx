import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import { toolbarControlButtonClassName } from '@roadiehq/ui/toolbar';
import { cn } from '@roadiehq/ui/utils';

export interface OverviewBulkAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

interface OverviewBulkActionsProps {
  selectedCount: number;
  actions?: OverviewBulkAction[];
  destructiveActions?: OverviewBulkAction[];
}

function BulkActionItem({
  action,
  selectedCount,
  destructive = false,
}: {
  action: OverviewBulkAction;
  selectedCount: number;
  destructive?: boolean;
}) {
  const Icon = action.icon;

  return (
    <DropdownMenuItem
      disabled={action.disabled}
      onSelect={action.onSelect}
      className={cn(
        destructive &&
          'text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive',
      )}
    >
      <Icon />
      {action.label} {selectedCount}
    </DropdownMenuItem>
  );
}

export function OverviewBulkActions({
  selectedCount,
  actions = [],
  destructiveActions = [],
}: OverviewBulkActionsProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(toolbarControlButtonClassName, 'tabular-nums')}
        >
          {selectedCount} selected
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.map(action => (
          <BulkActionItem
            key={action.label}
            action={action}
            selectedCount={selectedCount}
          />
        ))}
        {actions.length > 0 && destructiveActions.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {destructiveActions.map(action => (
          <BulkActionItem
            key={action.label}
            action={action}
            selectedCount={selectedCount}
            destructive
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
