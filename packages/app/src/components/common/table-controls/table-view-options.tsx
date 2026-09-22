import { Columns3 } from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

export interface TableViewOptionsProps<T> {
  table: Table<T>;
  onReset?: () => void;
}

function columnLabel(column: {
  id: string;
  columnDef: { header?: unknown; meta?: unknown };
}): string {
  const meta = column.columnDef.meta;
  if (
    typeof meta === 'object' &&
    meta !== null &&
    'label' in meta &&
    typeof meta.label === 'string'
  ) {
    return meta.label;
  }
  return typeof column.columnDef.header === 'string'
    ? column.columnDef.header
    : column.id;
}

export function TableViewOptions<T>({
  table,
  onReset,
}: TableViewOptionsProps<T>): JSX.Element | null {
  const columns = table
    .getAllLeafColumns()
    .filter(column => column.getCanHide());

  if (columns.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 data-[state=open]:bg-accent"
                aria-label="Display columns"
              >
                <Columns3 aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Display columns</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Display columns</DropdownMenuLabel>
          <DropdownMenuGroup>
            {columns.map(column => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={checked =>
                  column.toggleVisibility(checked === true)
                }
                onSelect={event => event.preventDefault()}
              >
                {columnLabel(column)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {onReset ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={event => {
                    event.preventDefault();
                    onReset();
                  }}
                >
                  Reset columns
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
