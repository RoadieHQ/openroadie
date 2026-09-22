import React, { useRef, useState } from 'react';
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import { Input } from '@roadiehq/ui/input';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { useFeatureFlag, type Workspace } from '../../api';
import { useDelayedFlag } from '../common';
import { WorkspaceCreateDialog } from './workspace-form-dialog';
import { FallbackWorkspaceMark, WorkspaceMark } from './workspace-mark';
import { useWorkspaces } from './workspace-context';

export const COMING_SOON_LABEL = 'Coming soon';

function SectionItems({
  workspaces,
  activeId,
  onSelect,
}: {
  workspaces: Workspace[];
  activeId: string | undefined;
  onSelect: (workspace: Workspace) => void;
}) {
  return (
    <>
      {workspaces.map(workspace => (
        <DropdownMenuItem
          key={workspace.id}
          onSelect={() => onSelect(workspace)}
        >
          <WorkspaceMark workspace={workspace} size="group" />
          <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
          {workspace.id === activeId && (
            <Check aria-label="Active workspace" className="text-primary" />
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * The sidebar rail's identity control: which workspace you are in, and the way
 * to another. Replaces the product logo, so it renders in both rail widths and
 * never leaves the rail empty while the list loads.
 */
export function WorkspacePicker({ collapsed }: { collapsed: boolean }) {
  const { workspaces, activeWorkspace, loading, setActiveWorkspace } =
    useWorkspaces();
  const { value: creationEnabled } = useFeatureFlag(
    'workspace-creation',
    false,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const showSkeleton = useDelayedFlag(loading);

  const query = search.trim().toLowerCase();
  const matches = (workspace: Workspace) =>
    !query ||
    workspace.name.toLowerCase().includes(query) ||
    workspace.slug.toLowerCase().includes(query);
  const organizations = workspaces.filter(
    w => w.type === 'organization' && matches(w),
  );
  const teams = workspaces.filter(w => w.type === 'team' && matches(w));
  const personal = workspaces.filter(w => w.type === 'personal' && matches(w));
  const hasMatches =
    organizations.length > 0 || teams.length > 0 || personal.length > 0;

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size={null}
      aria-label={
        activeWorkspace
          ? `Workspace: ${activeWorkspace.name}`
          : 'Select a workspace'
      }
      className={cn(
        'motion-colors flex h-10 min-w-0 items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent',
        collapsed ? 'w-10 justify-center p-0' : 'w-full gap-2 px-2',
      )}
    >
      {activeWorkspace ? (
        <WorkspaceMark workspace={activeWorkspace} well={false} />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center">
          <FallbackWorkspaceMark />
        </span>
      )}
      {!collapsed && (
        <>
          {showSkeleton || !activeWorkspace ? (
            <Skeleton className="h-4 w-24 flex-1" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
              {activeWorkspace.name}
            </span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/60" />
        </>
      )}
    </Button>
  );

  return (
    <>
      <DropdownMenu
        onOpenChange={open => {
          if (open) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
          } else {
            setSearch('');
          }
        }}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              {activeWorkspace?.name ?? 'Workspaces'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        )}

        <DropdownMenuContent align="start" className="w-60">
          <div className="relative p-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              ref={searchInputRef}
              aria-label="Search workspaces"
              autoComplete="off"
              placeholder="Search workspaces…"
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  return;
                }
                event.stopPropagation();
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  event.currentTarget
                    .closest('[role="menu"]')
                    ?.querySelector<HTMLElement>(
                      '[role="menuitem"]:not([aria-disabled="true"])',
                    )
                    ?.focus();
                }
              }}
              className="pl-8 shadow-none"
            />
          </div>

          <DropdownMenuSeparator />

          <div className="max-h-72 overflow-y-auto">
            {organizations.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Organization</DropdownMenuLabel>
                <SectionItems
                  workspaces={organizations}
                  activeId={activeWorkspace?.id}
                  onSelect={setActiveWorkspace}
                />
              </DropdownMenuGroup>
            )}

            {organizations.length > 0 && teams.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {teams.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Teams</DropdownMenuLabel>
                <SectionItems
                  workspaces={teams}
                  activeId={activeWorkspace?.id}
                  onSelect={setActiveWorkspace}
                />
              </DropdownMenuGroup>
            )}

            {(organizations.length > 0 || teams.length > 0) &&
              personal.length > 0 && <DropdownMenuSeparator />}

            {personal.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Personal</DropdownMenuLabel>
                <SectionItems
                  workspaces={personal}
                  activeId={activeWorkspace?.id}
                  onSelect={setActiveWorkspace}
                />
              </DropdownMenuGroup>
            )}

            {!hasMatches && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No workspaces found
              </p>
            )}
          </div>

          <DropdownMenuSeparator />

          {creationEnabled ? (
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
              <Plus />
              New workspace
            </DropdownMenuItem>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  aria-disabled
                  onSelect={event => event.preventDefault()}
                  className="cursor-not-allowed opacity-50"
                >
                  <Plus />
                  New workspace
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right">{COMING_SOON_LABEL}</TooltipContent>
            </Tooltip>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setActiveWorkspace}
      />
    </>
  );
}
