import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Loader2, Plus, Users, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Checkbox } from '@roadiehq/ui/checkbox';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { cn } from '@roadiehq/ui/utils';
import { useWorkflows, useAlert } from '../../../api';
import { contextGroupSeedsQuery, queryKeys } from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { contextGroupEdit } from '../../../config/paths';
import type { ContextGroupSeed } from '../../../api/workflow/workflow-client';

/** "N of M sources enabled" — a group whose sources are all missing will stay
 *  empty until those data sources are enabled, so tint the zero case. The
 *  group still lights up later automatically: datasource seed names are
 *  resolved at read time. */
function ReadinessBadge({ seed }: { seed: ContextGroupSeed }) {
  const { enabled, total } = seed.dataSources;
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        enabled === 0
          ? 'bg-warning/10 text-warning'
          : 'bg-accent text-muted-foreground',
      )}
    >
      {enabled} of {total} sources enabled
    </span>
  );
}

function UpdateBadge() {
  return (
    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
      Update available
    </span>
  );
}

function isSelectable(seed: ContextGroupSeed): boolean {
  return !seed.created || seed.updateAvailable === true;
}

function SeedRow({
  seed,
  selected,
  applying,
  onToggle,
  onOpenGroup,
}: {
  seed: ContextGroupSeed;
  selected: boolean;
  applying: boolean;
  onToggle: (slug: string) => void;
  onOpenGroup: (ruleId: string) => void;
}) {
  const selectable = isSelectable(seed);
  const createdAndCurrent = seed.created && !seed.updateAvailable;
  const existingRuleId = createdAndCurrent ? seed.ruleId : undefined;

  const activate = () => {
    if (applying) return;
    if (existingRuleId) {
      onOpenGroup(existingRuleId);
      return;
    }
    if (selectable) onToggle(seed.slug);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      className={cn(
        'motion-colors flex cursor-pointer items-start gap-2.5 rounded px-3 py-2 hover:bg-accent/40',
        createdAndCurrent && !existingRuleId && 'cursor-default opacity-40',
        existingRuleId && 'opacity-60 hover:opacity-100',
        applying && 'pointer-events-none opacity-60',
      )}
    >
      <Checkbox
        checked={createdAndCurrent || selected}
        disabled={!selectable || applying}
        onClick={e => e.stopPropagation()}
        onCheckedChange={() => {
          if (selectable) onToggle(seed.slug);
        }}
        className="mt-0.5 size-3.5 border-muted-foreground data-[state=checked]:border-foreground data-[state=checked]:bg-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-[12px] font-medium text-foreground',
              createdAndCurrent && 'line-through',
            )}
          >
            {seed.name}
          </span>
          {seed.updateAvailable && <UpdateBadge />}
          {!createdAndCurrent && <ReadinessBadge seed={seed} />}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {seed.description}
        </p>
      </div>
    </div>
  );
}

function SeedListBody({
  seeds,
  hiddenCount,
  showUnavailable,
  onToggleUnavailable,
  selectedSlugs,
  onToggleSeed,
  onOpenGroup,
  onCreateCustom,
  applying,
}: {
  seeds: ContextGroupSeed[];
  /** Seeds filtered out because none of their data sources exist yet. */
  hiddenCount: number;
  showUnavailable: boolean;
  onToggleUnavailable: () => void;
  selectedSlugs: Set<string>;
  onToggleSeed: (slug: string) => void;
  onOpenGroup: (ruleId: string) => void;
  /** Renders a custom-create row at the list bottom. Omitted in the compact
   *  dialog, where the custom action is its own pane. */
  onCreateCustom?: () => void;
  applying: boolean;
}) {
  const selectableSeeds = useMemo(() => seeds.filter(isSelectable), [seeds]);

  const allSelectableSelected =
    selectableSeeds.length > 0 &&
    selectableSeeds.every(seed => selectedSlugs.has(seed.slug));

  const someSelectableSelected =
    !allSelectableSelected &&
    selectableSeeds.some(seed => selectedSlugs.has(seed.slug));

  const handleToggleAll = useCallback(() => {
    for (const seed of selectableSeeds) {
      if (allSelectableSelected) {
        if (selectedSlugs.has(seed.slug)) onToggleSeed(seed.slug);
      } else {
        if (!selectedSlugs.has(seed.slug)) onToggleSeed(seed.slug);
      }
    }
  }, [selectableSeeds, allSelectableSelected, selectedSlugs, onToggleSeed]);

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
      <div className="flex flex-col py-0.5">
        {seeds.map(seed => (
          <SeedRow
            key={seed.slug}
            seed={seed}
            selected={selectedSlugs.has(seed.slug)}
            applying={applying}
            onToggle={onToggleSeed}
            onOpenGroup={onOpenGroup}
          />
        ))}
        {(hiddenCount > 0 || showUnavailable) && (
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'h-auto justify-start px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground',
              applying && 'pointer-events-none opacity-60',
            )}
            disabled={applying}
            onClick={onToggleUnavailable}
          >
            {showUnavailable
              ? 'Hide templates with no available data sources'
              : `Show ${hiddenCount} more with no available data sources`}
          </Button>
        )}
        {onCreateCustom && (
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'motion-colors mt-1 flex h-auto w-full justify-start gap-2.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-left shadow-sm hover:border-primary/60 hover:bg-primary/10 hover:text-primary',
              applying && 'pointer-events-none opacity-60',
            )}
            disabled={applying}
            onClick={onCreateCustom}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-primary/50 bg-primary/15 text-primary">
              <Plus className="size-2.5" />
            </span>
            <span className="min-w-0 flex-1 text-[12px] font-medium text-primary">
              Create custom context group
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}

function ApplyButton({
  totalSelected,
  applying,
  onApply,
}: {
  totalSelected: number;
  applying: boolean;
  onApply: () => void;
}) {
  return (
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
        'Enable context groups'
      ) : (
        'Enable context group'
      )}
    </Button>
  );
}

const LOADING_SKELETONS = (
  <div className="flex flex-col gap-1 px-5 pt-14 pb-5">
    {Array.from({ length: 6 }, (_, i) => (
      <Skeleton key={i} className="h-[52px] w-full rounded-lg" />
    ))}
  </div>
);

export interface ContextGroupSeedPickerProps {
  onComplete: () => void;
  onCreateCustom: () => void;
  onClose?: () => void;
  /** Lets a host dialog block close requests while seeds are being applied. */
  onApplyingChange?: (applying: boolean) => void;
  variant?: 'inline' | 'compact';
}

export function ContextGroupSeedPicker({
  onComplete,
  onCreateCustom,
  onClose,
  onApplyingChange,
  variant = 'inline',
}: ContextGroupSeedPickerProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const navigate = useNavigate();

  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [showUnavailable, setShowUnavailable] = useState(false);

  const seedsQuery = useQuery(contextGroupSeedsQuery(api));
  const seeds = seedsQuery.data?.data;

  // A template with no matching data sources produces a group that stays
  // empty, so hide those by default. Created rules always show — they exist.
  const isAvailable = useCallback(
    (seed: ContextGroupSeed) => seed.created || seed.dataSources.available > 0,
    [],
  );
  const visibleSeeds = useMemo(() => {
    if (!seeds) return [];
    return showUnavailable ? seeds : seeds.filter(isAvailable);
  }, [seeds, showUnavailable, isAvailable]);
  const hiddenCount = (seeds?.length ?? 0) - visibleSeeds.length;

  const toggleUnavailable = useCallback(() => {
    setShowUnavailable(prev => {
      const next = !prev;
      if (!next && seeds) {
        // Drop selections that are about to be hidden so the apply count
        // never includes rows the user can no longer see.
        setSelectedSlugs(current => {
          const kept = new Set(
            seeds
              .filter(isAvailable)
              .map(seed => seed.slug)
              .filter(slug => current.has(slug)),
          );
          return kept;
        });
      }
      return next;
    });
  }, [seeds, isAvailable]);

  const toggleSeed = useCallback((slug: string) => {
    setSelectedSlugs(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const applyMutation = useInvalidatingMutation({
    mutationFn: (slugs: string[]) =>
      api.workflows.applyContextGroupSeeds(slugs),
    invalidates: [
      queryKeys.contextGroupSeeds,
      queryKeys.contextGroupRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });
  const applying = applyMutation.isPending;

  const openGroup = useCallback(
    (ruleId: string) => {
      onClose?.();
      navigate(contextGroupEdit(ruleId));
    },
    [navigate, onClose],
  );

  const handleApply = useCallback(async () => {
    if (selectedSlugs.size === 0 || applying) return;
    onApplyingChange?.(true);
    try {
      const result = await applyMutation.mutateAsync(Array.from(selectedSlugs));
      const { created, updated } = result.data;
      const createdMessage = `Created ${created} context group${created === 1 ? '' : 's'}`;
      const message =
        updated > 0 ? `${createdMessage}, updated ${updated}` : createdMessage;
      setSelectedSlugs(new Set());
      onComplete();
      alertApi.post({
        message,
        severity: 'success',
        display: 'transient',
      });
    } catch (error) {
      alertApi.post({
        message: `Failed to create context groups: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    } finally {
      onApplyingChange?.(false);
    }
  }, [
    selectedSlugs,
    applying,
    applyMutation,
    alertApi,
    onComplete,
    onApplyingChange,
  ]);

  const totalSelected = selectedSlugs.size;

  if (seedsQuery.isLoading) {
    return LOADING_SKELETONS;
  }

  if (seedsQuery.error || !seeds) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <Users className="mb-6 size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Failed to load context group templates. Please try again.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" onClick={() => void seedsQuery.refetch()}>
            Retry
          </Button>
          <Button variant="outline" onClick={onCreateCustom}>
            <Plus className="size-4" />
            Create custom context group
          </Button>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              New context group
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Choose a template or start from scratch.
            </p>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={applying}
              className="size-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <SeedListBody
            seeds={visibleSeeds}
            hiddenCount={hiddenCount}
            showUnavailable={showUnavailable}
            onToggleUnavailable={toggleUnavailable}
            selectedSlugs={selectedSlugs}
            onToggleSeed={toggleSeed}
            onOpenGroup={openGroup}
            applying={applying}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border/40 px-5 py-3">
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            {totalSelected > 0
              ? `${totalSelected} context group${totalSelected === 1 ? '' : 's'} selected`
              : 'No context groups selected'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12px]"
            disabled={applying}
            onClick={onCreateCustom}
          >
            <Plus className="size-3.5" />
            Create custom context group
          </Button>
          <ApplyButton
            totalSelected={totalSelected}
            applying={applying}
            onApply={handleApply}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div className="mb-5 flex flex-col items-center gap-2 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-accent">
          <Users className="size-7 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground">
          No context groups yet
        </h3>
        <p className="max-w-md text-[13px] text-muted-foreground">
          A context group gathers related objects from across your data sources
          into one named, always-up-to-date view. Enable a template below, or
          start from scratch.
        </p>
      </div>
      <div className="w-full max-w-lg">
        <div className="rounded-lg border border-border/60">
          <div className="max-h-[420px] overflow-y-auto px-1 py-1">
            <SeedListBody
              seeds={visibleSeeds}
              hiddenCount={hiddenCount}
              showUnavailable={showUnavailable}
              onToggleUnavailable={toggleUnavailable}
              selectedSlugs={selectedSlugs}
              onToggleSeed={toggleSeed}
              onOpenGroup={openGroup}
              onCreateCustom={onCreateCustom}
              applying={applying}
            />
          </div>
        </div>
        {totalSelected > 0 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <span className="text-[12px] text-muted-foreground">
              {totalSelected} selected
            </span>
            <ApplyButton
              totalSelected={totalSelected}
              applying={applying}
              onApply={handleApply}
            />
          </div>
        )}
      </div>
    </div>
  );
}
