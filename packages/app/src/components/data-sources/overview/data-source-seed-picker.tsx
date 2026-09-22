/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowRight, Database, Loader2, Plus, Search, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Checkbox } from '@roadiehq/ui/checkbox';
import { Input } from '@roadiehq/ui/input';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { useWorkflows, useAlert } from '../../../api';
import {
  dataSourceSeedsQuery,
  integrationsListQuery,
  logosCatalogQuery,
  queryKeys,
} from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import {
  PATHS,
  dataSourceDetail,
  integrationDetail,
} from '../../../config/paths';
import type { DataSourceSeed } from '../../../api/workflow/workflow-client';

interface IntegrationGroup {
  slug: string;
  integrationId: string | undefined;
  name: string;
  logoUrl: string;
  /** Whether the backing integration is set up (secrets + config resolved). A
   *  seed for an unconnected integration creates a data source that can't run
   *  until the integration is connected — surface that before it happens. */
  configured: boolean;
  seeds: DataSourceSeed[];
}

/** A small "Not connected" pill for an integration group whose secrets aren't
 *  set. Connected groups show nothing — green-on-everything is just noise. */
function ConnectionBadge({ configured }: { configured: boolean }) {
  if (configured) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
      <span className="size-1.5 rounded-full bg-warning" />
      Not connected
    </span>
  );
}

/** Shown above the seed list for an unconnected integration: adding a data
 *  source here is allowed, but it can't ingest until the integration is set up
 *  — so offer the fix inline rather than letting the user discover a dead
 *  source later (fixes onboarding gap G3). */
function ConnectHintBar({
  name,
  onConnect,
}: {
  name: string;
  onConnect: () => void;
}) {
  return (
    <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
      <p className="min-w-0 flex-1 text-[12px] text-foreground">
        <span className="font-medium">{name}</span> isn't connected. Data
        sources you add won't ingest until you connect it.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1.5 text-[12px]"
        onClick={onConnect}
      >
        Connect
        <ArrowRight className="size-3" />
      </Button>
    </div>
  );
}

const SLUG_DISPLAY_NAMES = new Map<string, string>([
  ['circleci', 'CircleCI'],
  ['github-token', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['humanitec', 'Humanitec'],
  ['pagerduty', 'PagerDuty'],
  ['pulumi', 'Pulumi'],
  ['shortcut', 'Shortcut'],
  ['launchdarkly', 'LaunchDarkly'],
  ['snyk', 'Snyk'],
]);

const SLUG_DESCRIPTIONS = new Map<string, string>([
  [
    'circleci',
    'Pipelines, workflows, and jobs discovered across all accessible organizations.',
  ],
  ['github-token', 'Repos, PRs, teams, actions, and more.'],
  [
    'gitlab',
    'Projects, groups, members, tags, releases, pipelines, environments, and deployments.',
  ],
  [
    'humanitec',
    'Organizations, applications, and environments discovered from the API token.',
  ],
  ['pagerduty', 'Services, incidents, schedules, on-calls, and more.'],
  ['shortcut', 'Epics, stories, projects, and members.'],
  ['launchdarkly', 'Projects, flags, environments, teams, and more.'],
  [
    'pulumi',
    'Organizations, stacks, and stack deployments discovered from the authenticated user.',
  ],
  [
    'snyk',
    'Organizations, memberships, targets, and projects discovered across all accessible organizations.',
  ],
]);

function getDisplayName(slug: string, integrationName?: string): string {
  return integrationName ?? SLUG_DISPLAY_NAMES.get(slug) ?? slug;
}

function groupSeedsByIntegration(
  seeds: DataSourceSeed[],
  integrationsBySlug: Map<
    string,
    { id: string; name: string; logoUrl: string }
  >,
): IntegrationGroup[] {
  const groupMap = new Map<string, IntegrationGroup>();

  for (const seed of seeds) {
    let group = groupMap.get(seed.integrationSlug);
    if (!group) {
      const integration = integrationsBySlug.get(seed.integrationSlug);
      group = {
        slug: seed.integrationSlug,
        integrationId: integration?.id,
        name: getDisplayName(seed.integrationSlug, integration?.name),
        logoUrl: integration?.logoUrl ?? '',
        // All seeds for one integration share the same connection state, so the
        // first seed's flag is representative.
        configured: seed.integrationConfigured,
        seeds: [],
      };
      groupMap.set(seed.integrationSlug, group);
    }
    group.seeds.push(seed);
  }

  for (const group of groupMap.values()) {
    group.seeds.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }

  return Array.from(groupMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

function IntegrationSidebar({
  groups,
  activeSlug,
  selectedSeeds,
  search,
  onSearchChange,
  onSelect,
  onCreateIntegration,
}: {
  groups: IntegrationGroup[];
  activeSlug: string | null;
  selectedSeeds: Set<string>;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (slug: string) => void;
  onCreateIntegration?: () => void;
}) {
  return (
    <div className="flex w-[200px] shrink-0 flex-col border-r border-border/40">
      <div className="shrink-0 p-2.5 pb-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="h-7 w-full rounded-md pl-8 text-[12px]"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {groups.map(group => {
          const isActive = group.slug === activeSlug;
          const selectedInGroup = group.seeds.filter(
            s => !s.created && selectedSeeds.has(s.name),
          ).length;

          return (
            <Button
              key={group.slug}
              variant="ghost"
              onClick={() => onSelect(group.slug)}
              className={cn(
                'flex h-auto w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left',
                isActive
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <IntegrationIconFrame size="group">
                <IntegrationLogo src={group.logoUrl} size={14} />
              </IntegrationIconFrame>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                {group.name}
              </span>
              {!group.configured && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warning"
                  title="Integration not connected"
                />
              )}
              {selectedInGroup > 0 && (
                <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                  {selectedInGroup}
                </span>
              )}
            </Button>
          );
        })}
        {onCreateIntegration && (
          <div className="mt-1 border-t border-border/40 pt-1.5">
            <Button
              variant="ghost"
              onClick={onCreateIntegration}
              className="flex h-auto w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-primary hover:bg-primary/5 hover:text-primary"
            >
              <span className="flex size-4.5 shrink-0 items-center justify-center rounded-sm border border-primary/50 bg-primary/10 text-primary">
                <Plus className="size-3" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                Add new integration
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SeedList({
  group,
  selectedSeeds,
  onToggleSeed,
  onOpenDataSource,
  onCreateCustom,
  applying,
}: {
  group: IntegrationGroup;
  selectedSeeds: Set<string>;
  onToggleSeed: (seedName: string) => void;
  onOpenDataSource: (workflowId: string) => void;
  onCreateCustom?: (integrationId?: string) => void;
  applying: boolean;
}) {
  const selectableSeeds = useMemo(
    () => group.seeds.filter(s => !s.created),
    [group.seeds],
  );

  const allSelectableSelected =
    selectableSeeds.length > 0 &&
    selectableSeeds.every(s => selectedSeeds.has(s.name));

  const someSelectableSelected =
    !allSelectableSelected &&
    selectableSeeds.some(s => selectedSeeds.has(s.name));

  const handleToggleAll = useCallback(() => {
    for (const seed of selectableSeeds) {
      if (allSelectableSelected) {
        if (selectedSeeds.has(seed.name)) onToggleSeed(seed.name);
      } else {
        if (!selectedSeeds.has(seed.name)) onToggleSeed(seed.name);
      }
    }
  }, [selectableSeeds, allSelectableSelected, selectedSeeds, onToggleSeed]);

  return (
    <div className="flex flex-col">
      {selectableSeeds.length > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!applying) handleToggleAll();
          }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ' ') && !applying) {
              e.preventDefault();
              handleToggleAll();
            }
          }}
          className={cn(
            'flex cursor-pointer items-center gap-2.5 border-b border-border/40 px-3 py-1.5',
            applying && 'pointer-events-none opacity-60',
          )}
        >
          <Checkbox
            checked={
              allSelectableSelected
                ? true
                : someSelectableSelected
                  ? 'indeterminate'
                  : false
            }
            disabled={applying}
            onClick={e => e.stopPropagation()}
            onCheckedChange={handleToggleAll}
            className="size-3.5 border-muted-foreground data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=indeterminate]:border-foreground data-[state=indeterminate]:bg-foreground"
          />
          <span className="text-[11px] font-medium text-muted-foreground">
            Select all ({selectableSeeds.length})
          </span>
        </div>
      )}
      <TooltipProvider delayDuration={700}>
        <div className="flex flex-col py-0.5">
          {group.seeds.map(seed => {
            const isCreated = seed.created;
            const isSelected = selectedSeeds.has(seed.name);
            const existingWorkflowId = isCreated ? seed.workflowId : undefined;
            const row = (
              <div
                key={seed.name}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (existingWorkflowId) {
                    onOpenDataSource(existingWorkflowId);
                    return;
                  }
                  if (!isCreated && !applying) onToggleSeed(seed.name);
                }}
                onKeyDown={e => {
                  if (
                    (e.key === 'Enter' || e.key === ' ') &&
                    existingWorkflowId
                  ) {
                    e.preventDefault();
                    onOpenDataSource(existingWorkflowId);
                    return;
                  }
                  if (
                    (e.key === 'Enter' || e.key === ' ') &&
                    !isCreated &&
                    !applying
                  ) {
                    e.preventDefault();
                    onToggleSeed(seed.name);
                  }
                }}
                className={cn(
                  'motion-colors flex cursor-pointer items-center gap-2.5 rounded px-3 py-1.5 hover:bg-accent/40',
                  isCreated &&
                    !existingWorkflowId &&
                    'cursor-default opacity-40',
                  existingWorkflowId && 'opacity-60 hover:opacity-100',
                  applying && 'pointer-events-none opacity-60',
                )}
              >
                <Checkbox
                  checked={isCreated || isSelected}
                  disabled={isCreated || applying}
                  onClick={e => e.stopPropagation()}
                  onCheckedChange={() => {
                    if (!isCreated) onToggleSeed(seed.name);
                  }}
                  className="size-3.5 border-muted-foreground data-[state=checked]:border-foreground data-[state=checked]:bg-foreground"
                />
                <span
                  className={cn(
                    'text-[12px] font-medium text-foreground',
                    isCreated && 'line-through',
                  )}
                >
                  {seed.name}
                </span>
              </div>
            );

            if (seed.description) {
              return (
                <Tooltip key={seed.name}>
                  <TooltipTrigger asChild>{row}</TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="center"
                    className="max-w-[280px]"
                  >
                    {seed.description}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return row;
          })}
          {onCreateCustom && (
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'motion-colors mt-1 flex h-auto w-full justify-start gap-2.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-left shadow-sm hover:border-primary/60 hover:bg-primary/10 hover:text-primary',
                applying && 'pointer-events-none opacity-60',
              )}
              disabled={applying}
              onClick={() => onCreateCustom(group.integrationId)}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-primary/50 bg-primary/15 text-primary">
                <Plus className="size-2.5" />
              </span>
              <span className="min-w-0 flex-1 text-[12px] font-medium text-primary">
                Add custom data source
              </span>
            </Button>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact layout (dialog) – sidebar + main area
// ---------------------------------------------------------------------------

function CompactLayout({
  groups,
  allGroups,
  selectedSeeds,
  onToggleSeed,
  onCreateCustom,
  onCreateIntegration,
  onConnect,
  onApply,
  onClose,
  applying,
}: {
  groups: IntegrationGroup[];
  allGroups: IntegrationGroup[];
  selectedSeeds: Set<string>;
  onToggleSeed: (seedName: string) => void;
  onCreateCustom?: (integrationId?: string) => void;
  onCreateIntegration?: () => void;
  onConnect: (group: IntegrationGroup) => void;
  onApply: () => void;
  onClose?: () => void;
  applying: boolean;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(
    groups[0]?.slug ?? null,
  );

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      g => g.name.toLowerCase().includes(q) || g.slug.toLowerCase().includes(q),
    );
  }, [groups, search]);

  const activeGroup = useMemo(
    () => allGroups.find(g => g.slug === activeSlug) ?? null,
    [allGroups, activeSlug],
  );

  const totalSelected = useMemo(() => {
    let count = 0;
    for (const group of allGroups) {
      for (const seed of group.seeds) {
        if (!seed.created && selectedSeeds.has(seed.name)) count++;
      }
    }
    return count;
  }, [allGroups, selectedSeeds]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            New data source
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Choose a template or add a new integration.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={applying}
              className="size-7 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <IntegrationSidebar
          groups={filteredGroups}
          activeSlug={activeSlug}
          selectedSeeds={selectedSeeds}
          search={search}
          onSearchChange={setSearch}
          onSelect={setActiveSlug}
          onCreateIntegration={onCreateIntegration}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeGroup ? (
            <>
              {!activeGroup.configured && (
                <ConnectHintBar
                  name={activeGroup.name}
                  onConnect={() => onConnect(activeGroup)}
                />
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-1">
                <SeedList
                  group={activeGroup}
                  selectedSeeds={selectedSeeds}
                  onToggleSeed={onToggleSeed}
                  onOpenDataSource={workflowId =>
                    navigate(dataSourceDetail(workflowId))
                  }
                  onCreateCustom={onCreateCustom}
                  applying={applying}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[13px] text-muted-foreground">
                Select an integration to see available data sources.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 px-5 py-3">
        <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          {totalSelected > 0
            ? `${totalSelected} data source${totalSelected === 1 ? '' : 's'} selected`
            : 'No data sources selected'}
        </p>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          disabled={totalSelected === 0 || applying}
          onClick={onApply}
        >
          {applying ? (
            <>
              <Loader2 className="motion-icon-spin size-3.5" />
              Creating…
            </>
          ) : totalSelected > 1 ? (
            'Enable data sources'
          ) : (
            'Enable data source'
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline layout (empty-state page) – hero + integration list
// ---------------------------------------------------------------------------

function InlineLayout({
  groups,
  selectedSeeds,
  onToggleSeed,
  onCreateCustom,
  onConnect,
  onApply,
  applying,
}: {
  groups: IntegrationGroup[];
  selectedSeeds: Set<string>;
  onToggleSeed: (seedName: string) => void;
  onCreateCustom?: (integrationId?: string) => void;
  onConnect: (group: IntegrationGroup) => void;
  onApply: () => void;
  applying: boolean;
}) {
  const navigate = useNavigate();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      g => g.name.toLowerCase().includes(q) || g.slug.toLowerCase().includes(q),
    );
  }, [groups, search]);

  const activeGroup = useMemo(
    () => groups.find(g => g.slug === activeSlug) ?? null,
    [groups, activeSlug],
  );

  const totalSelected = useMemo(() => {
    let count = 0;
    for (const group of groups) {
      for (const seed of group.seeds) {
        if (!seed.created && selectedSeeds.has(seed.name)) count++;
      }
    }
    return count;
  }, [groups, selectedSeeds]);

  if (!activeSlug) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent">
            <Database className="size-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Get started with data sources
          </h3>
          <p className="max-w-md text-[13px] text-muted-foreground">
            Choose an integration to browse available templates, or start from
            scratch.
          </p>
          <Button
            variant="link"
            size="sm"
            className="h-auto gap-1.5 p-0 text-[12px]"
            onClick={() => navigate(PATHS.INTEGRATIONS)}
          >
            Recommended: connect an integration to add its data sources
            automatically
            <ArrowRight className="size-3" />
          </Button>
        </div>
        <div className="flex min-h-0 w-full max-w-md flex-1 flex-col">
          <div className="mb-3 shrink-0">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search integrations…"
                className="h-9 w-full rounded-md pl-9 text-sm"
              />
            </div>
          </div>
          <TooltipProvider delayDuration={2000}>
            <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
              {filteredGroups.map(group => {
                const description = SLUG_DESCRIPTIONS.get(group.slug) ?? '';
                return (
                  <Button
                    key={group.slug}
                    variant="ghost"
                    onClick={() => setActiveSlug(group.slug)}
                    className="motion-colors flex h-auto shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent/50"
                  >
                    <IntegrationIconFrame size="group">
                      <IntegrationLogo src={group.logoUrl} size={16} />
                    </IntegrationIconFrame>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {group.name}
                      </span>
                      {description && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate text-[11px] leading-snug text-muted-foreground">
                              {description}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {description}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <ConnectionBadge configured={group.configured} />
                  </Button>
                );
              })}
            </div>
          </TooltipProvider>
          {onCreateCustom && (
            <div className="mt-3 shrink-0 border-t border-border pt-3 text-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onCreateCustom()}
              >
                <Plus className="size-3.5" />
                Add custom data source
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div className="w-full max-w-lg">
        <div className="mb-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveSlug(null)}
            className="h-7 gap-1.5 px-2 text-[12px] text-muted-foreground"
          >
            Back
          </Button>
          <IntegrationIconFrame size="group">
            <IntegrationLogo src={activeGroup?.logoUrl ?? ''} size={14} />
          </IntegrationIconFrame>
          <span className="text-[13px] font-medium text-foreground">
            {activeGroup?.name}
          </span>
          {activeGroup && (
            <ConnectionBadge configured={activeGroup.configured} />
          )}
        </div>
        {activeGroup && !activeGroup.configured && (
          <div className="-mx-3 mb-3">
            <ConnectHintBar
              name={activeGroup.name}
              onConnect={() => onConnect(activeGroup)}
            />
          </div>
        )}
        {activeGroup && (
          <SeedList
            group={activeGroup}
            selectedSeeds={selectedSeeds}
            onToggleSeed={onToggleSeed}
            onOpenDataSource={workflowId =>
              navigate(dataSourceDetail(workflowId))
            }
            onCreateCustom={onCreateCustom}
            applying={applying}
          />
        )}
        {totalSelected > 0 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <span className="text-[12px] text-muted-foreground">
              {totalSelected} selected
            </span>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-[12px]"
              disabled={applying}
              onClick={onApply}
            >
              {applying ? (
                <>
                  <Loader2 className="motion-icon-spin size-3.5" />
                  Creating…
                </>
              ) : totalSelected > 1 ? (
                'Enable data sources'
              ) : (
                'Enable data source'
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const LOADING_SKELETONS = (
  <div className="flex flex-col gap-1 px-5 pt-14 pb-5">
    {Array.from({ length: 6 }, (_, i) => (
      <Skeleton key={i} className="h-[52px] w-full rounded-lg" />
    ))}
  </div>
);

interface DataSourceSeedPickerProps {
  onComplete: () => void;
  onCreateCustom?: (integrationId?: string) => void;
  onCreateIntegration?: () => void;
  onClose?: () => void;
  /** Lets a host dialog block close requests while seeds are being applied. */
  onApplyingChange?: (applying: boolean) => void;
  variant?: 'inline' | 'compact';
}

export function DataSourceSeedPicker({
  onComplete,
  onCreateCustom,
  onCreateIntegration,
  onClose,
  onApplyingChange,
  variant = 'inline',
}: DataSourceSeedPickerProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const navigate = useNavigate();

  const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set());

  const seedsQuery = useQuery(dataSourceSeedsQuery(api));
  const integrationsQuery = useQuery(integrationsListQuery(api));
  const logosQuery = useQuery(logosCatalogQuery(api));
  const seedsData = useMemo(() => {
    if (!seedsQuery.data || !integrationsQuery.data || !logosQuery.data) {
      return undefined;
    }

    const logoDataUriBySlug = new Map(
      logosQuery.data.map(l => [
        l.slug,
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`,
      ]),
    );

    const integrationsBySlug = new Map<
      string,
      { id: string; name: string; logoUrl: string }
    >();
    for (const integration of integrationsQuery.data.data) {
      const hasInlineLogo = integration.logoUrl.startsWith('data:');
      const slugLogo = integration.logoSlug
        ? logoDataUriBySlug.get(integration.logoSlug)
        : undefined;
      integrationsBySlug.set(integration.slug, {
        id: integration.id,
        name: integration.name,
        logoUrl: hasInlineLogo
          ? integration.logoUrl
          : (slugLogo ?? integration.logoUrl),
      });
    }

    return { seeds: seedsQuery.data.data, integrationsBySlug };
  }, [seedsQuery.data, integrationsQuery.data, logosQuery.data]);

  const allGroups = useMemo(() => {
    if (!seedsData) return [];
    return groupSeedsByIntegration(
      seedsData.seeds,
      seedsData.integrationsBySlug,
    );
  }, [seedsData]);

  const toggleSeed = useCallback((seedName: string) => {
    setSelectedSeeds(prev => {
      const next = new Set(prev);
      if (next.has(seedName)) {
        next.delete(seedName);
      } else {
        next.add(seedName);
      }
      return next;
    });
  }, []);

  const applyMutation = useInvalidatingMutation({
    mutationFn: (seedNames: string[]) =>
      api.workflows.applyDataSourceSeeds(seedNames),
    invalidates: [queryKeys.dataSourceSeeds, queryKeys.dataIngestionWorkflows],
  });
  const applying = applyMutation.isPending;

  const goToIntegration = useCallback(
    (group: IntegrationGroup) => {
      navigate(
        group.integrationId
          ? integrationDetail(group.integrationId)
          : PATHS.INTEGRATIONS,
      );
    },
    [navigate],
  );

  const handleApply = useCallback(async () => {
    if (selectedSeeds.size === 0 || applying) return;
    // Seeds whose backing integration isn't connected: the data source will be
    // created but can't ingest until the user sets it up. Route them there
    // instead of a bare success toast (allow-and-route, onboarding gap G3).
    const unconnectedGroups = allGroups.filter(
      group =>
        !group.configured &&
        group.seeds.some(seed => !seed.created && selectedSeeds.has(seed.name)),
    );
    onApplyingChange?.(true);
    try {
      const result = await applyMutation.mutateAsync(Array.from(selectedSeeds));
      const createdMessage = `Created ${result.data.inserted} data source${result.data.inserted === 1 ? '' : 's'}`;
      setSelectedSeeds(new Set());
      onComplete();
      const target = unconnectedGroups[0];
      if (target) {
        alertApi.post({
          message: `${createdMessage}. Connect ${target.name} to start ingesting.`,
          severity: 'info',
          display: 'transient',
        });
        goToIntegration(target);
      } else {
        alertApi.post({
          message: createdMessage,
          severity: 'success',
          display: 'transient',
        });
      }
    } catch (error) {
      alertApi.post({
        message: `Failed to create data sources: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    } finally {
      onApplyingChange?.(false);
    }
  }, [
    selectedSeeds,
    applying,
    allGroups,
    applyMutation,
    alertApi,
    onComplete,
    onApplyingChange,
    goToIntegration,
  ]);

  const loadError =
    seedsQuery.error ?? integrationsQuery.error ?? logosQuery.error;
  const loading =
    seedsQuery.isLoading ||
    integrationsQuery.isLoading ||
    logosQuery.isLoading ||
    (!seedsData && !loadError);

  if (loading) {
    return LOADING_SKELETONS;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <Database className="mb-6 size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Failed to load data source templates. Please try again.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void seedsQuery.refetch();
              void integrationsQuery.refetch();
              void logosQuery.refetch();
            }}
          >
            Retry
          </Button>
          {onCreateCustom && (
            <Button variant="outline" onClick={() => onCreateCustom()}>
              <Plus className="size-4" />
              Add custom data source
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (allGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-accent">
          <Database className="size-10 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-muted-foreground">
          No data source templates available
        </h3>
        <p className="max-w-[400px] text-sm text-muted-foreground">
          Data source templates will appear here once integration seeds are
          configured.
        </p>
        {onCreateCustom && (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => onCreateCustom()}
          >
            <Plus className="size-4" />
            Add custom data source
          </Button>
        )}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <CompactLayout
        groups={allGroups}
        allGroups={allGroups}
        selectedSeeds={selectedSeeds}
        onToggleSeed={toggleSeed}
        onCreateCustom={onCreateCustom}
        onCreateIntegration={onCreateIntegration}
        onConnect={goToIntegration}
        onApply={handleApply}
        onClose={onClose}
        applying={applying}
      />
    );
  }

  return (
    <InlineLayout
      groups={allGroups}
      selectedSeeds={selectedSeeds}
      onToggleSeed={toggleSeed}
      onCreateCustom={onCreateCustom}
      onConnect={goToIntegration}
      onApply={handleApply}
      applying={applying}
    />
  );
}
