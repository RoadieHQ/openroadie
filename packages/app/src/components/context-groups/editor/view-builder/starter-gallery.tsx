import { useQuery } from '@tanstack/react-query';
import { Card } from '@roadiehq/ui/card';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { cn } from '@roadiehq/ui/utils';
import { useDatastore } from '../../../../api';
import { workspaceQueryKey } from '../../../../api/workspace-scope';
import type { ContextGroupViewSchema } from '../../../../api/datastore/datastore-client';
import { countTokenRange, formatTokenRange } from '../token-counter';
import { compileViewTemplate } from './compile-template';
import { buildStarters, type ViewStarter } from './starter-specs';

/**
 * What this starter costs on a real group. Views exist to control how
 * much context an agent is handed, so the price is part of the choice — not
 * something to discover after saving.
 */
function StarterCost({
  ruleId,
  groupId,
  template,
}: {
  ruleId: string;
  groupId: string;
  template: string;
}) {
  const datastore = useDatastore();
  const { data, isLoading, error } = useQuery({
    queryKey: workspaceQueryKey(
      'contextGroups',
      'starterCost',
      ruleId,
      groupId,
      template,
    ),
    queryFn: () =>
      datastore.renderContextGroupViewPreview(ruleId, {
        template,
        groupId,
      }),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-4 w-16" />;
  }
  if (error || !data) {
    return null;
  }
  return (
    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
      {formatTokenRange(countTokenRange(data.rendered))} tokens
    </span>
  );
}

export interface ViewStarterGalleryProps {
  ruleId: string;
  schema?: ContextGroupViewSchema;
  loading?: boolean;
  onPick: (starter: ViewStarter) => void;
}

/**
 * The first screen of a new view: pick an outcome, not a blank template.
 * Every starter is built from this rule's own data sources and field profiles,
 * so "identifiers" and "essentials" mean something specific here.
 */
export function ViewStarterGallery({
  ruleId,
  schema,
  loading,
  onPick,
}: ViewStarterGalleryProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const starters = schema
    ? buildStarters(schema)
    : [
        {
          id: 'blank',
          title: 'Write the template myself',
          description: 'Start from a raw Liquid template.',
        },
      ];

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Start from</p>
      {starters.map(starter => (
        <Card
          key={starter.id}
          variant="flat"
          role="button"
          tabIndex={0}
          onClick={() => onPick(starter)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPick(starter);
            }
          }}
          className={cn(
            'motion-transform cursor-pointer space-y-1 p-3 hover:border-primary/50 hover:bg-accent/40',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{starter.title}</span>
            {starter.spec && schema?.sampleGroupId && (
              <StarterCost
                ruleId={ruleId}
                groupId={schema.sampleGroupId}
                template={compileViewTemplate(starter.spec)}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">{starter.description}</p>
        </Card>
      ))}
    </div>
  );
}
