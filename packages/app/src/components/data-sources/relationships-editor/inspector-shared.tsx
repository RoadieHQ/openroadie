import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import type { RelationshipRuleMatchStrategy } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import { dataSourceDetail } from '../../../config/paths';

export interface MatchStrategyDescriptor {
  value: RelationshipRuleMatchStrategy;
  label: string;
  description: string;
  /** Fits between source and target field snippets in "where A … B" rule summaries */
  ruleSummaryPhrase: string;
}

export const MATCH_STRATEGIES: ReadonlyArray<MatchStrategyDescriptor> = [
  {
    value: 'exact',
    label: 'Exact',
    description: 'Values must match exactly (case-sensitive).',
    ruleSummaryPhrase: 'exactly matches',
  },
  {
    value: 'contains',
    label: 'Substring',
    description: 'Target string contains the source string.',
    ruleSummaryPhrase: 'is contained in string',
  },
  {
    value: 'array_contains',
    label: 'In array',
    description: 'Source value appears as an element in the target array.',
    ruleSummaryPhrase: 'appears in array',
  },
  {
    value: 'regex',
    label: 'Regex',
    description: 'Target value matches source as a regex pattern.',
    ruleSummaryPhrase: 'matches regex',
  },
  {
    value: 'person_name_alias',
    label: 'Person name aliases',
    description: 'Fuzzy match for person names — handles initials and accents.',
    ruleSummaryPhrase: 'matches person name aliases',
  },
];

const MATCH_STRATEGY_VALUES = new Set<string>(
  MATCH_STRATEGIES.map(s => s.value),
);

export function describeMatchStrategy(
  strategy: RelationshipRuleMatchStrategy,
): string {
  return MATCH_STRATEGIES.find(s => s.value === strategy)?.description ?? '';
}

/** Short connector phrase for inline rule summaries ("A … B") */
export function ruleSummaryPhraseForMatchStrategy(
  strategy: RelationshipRuleMatchStrategy,
): string {
  return (
    MATCH_STRATEGIES.find(s => s.value === strategy)?.ruleSummaryPhrase ??
    'matches'
  );
}

export function isMatchStrategy(
  value: string,
): value is RelationshipRuleMatchStrategy {
  return MATCH_STRATEGY_VALUES.has(value);
}

export function formatTimestamp(
  value: string | undefined | null,
): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export function describeRuleOrigin(origin: string): string {
  switch (origin) {
    case 'manual':
      return 'Manual';
    case 'generated':
      return 'Generated';
    case 'suggested':
      return 'Suggested';
    default:
      return origin;
  }
}

export function describeRuleState(state: string): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'suggested':
      return 'Suggested';
    case 'inactive':
      return 'Inactive';
    case 'generated':
      return 'Generated';
    default:
      return state;
  }
}

export function formatPreviewValue(value: string | undefined): string {
  return value?.trim() || 'no value';
}

export function MetadataRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-32 shrink-0 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1 text-xs text-foreground">{children}</div>
    </div>
  );
}

interface DataSourceCardProps {
  ds: DataSourceItem | undefined;
  fallbackId: string;
  // Optional uppercase heading shown above the card body. The rule inspector
  // labels source/target cards ("Source", "Target"); the data source
  // inspector renders the card without a heading.
  heading?: string;
}

export function DataSourceCard({
  ds,
  fallbackId,
  heading,
}: DataSourceCardProps) {
  const id = ds?.id ?? fallbackId;
  const name = ds?.name ?? fallbackId;
  const logoUrl = ds?.logoUrl;
  const enabled = ds?.enabled;
  const objectCount = ds?.execution?.objectCount;
  const lastRunAt = formatTimestamp(ds?.execution?.lastRunAt);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      {heading && (
        <div className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          {heading}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
          {logoUrl ? <IntegrationLogo src={logoUrl} size={18} /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {name}
          </div>
          {ds && (
            <div className="text-2xs text-muted-foreground">
              {enabled ? 'Enabled' : 'Disabled'}
              {typeof objectCount === 'number' && (
                <> · {objectCount.toLocaleString()} objects</>
              )}
            </div>
          )}
        </div>
      </div>
      {lastRunAt && (
        <div className="text-2xs text-muted-foreground">
          Last run · {lastRunAt}
        </div>
      )}
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-7 w-full justify-between text-xs"
      >
        <Link to={dataSourceDetail(id)}>
          Open data source
          <ExternalLink className="size-3" />
        </Link>
      </Button>
    </div>
  );
}

interface RelationshipRowProps {
  direction: 'outbound' | 'inbound';
  otherLabel: string;
  relationshipType: string;
}

export function RelationshipRow({
  direction,
  otherLabel,
  relationshipType,
}: RelationshipRowProps) {
  const Icon = direction === 'outbound' ? ArrowUpRight : ArrowDownLeft;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {otherLabel}
      </span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
        {relationshipType}
      </span>
    </div>
  );
}

interface PillButtonProps {
  isActive: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

export function PillButton({
  isActive,
  count,
  onClick,
  children,
  className,
}: PillButtonProps) {
  return (
    <Button
      type="button"
      variant={isActive ? 'default' : 'outline'}
      size="sm"
      aria-pressed={isActive}
      className={cn(
        'h-7 gap-1.5 px-2 text-2xs',
        !isActive && 'text-muted-foreground',
        className,
      )}
      onClick={onClick}
    >
      {children}
      <span
        className={cn(
          'ml-1 rounded px-1 py-px font-mono text-2xs',
          isActive
            ? 'bg-primary-foreground/20'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </Button>
  );
}
