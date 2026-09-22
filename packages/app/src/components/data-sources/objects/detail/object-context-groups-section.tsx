import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { DetailSection } from '../../../common';
import { useDatastore } from '../../../../api';
import { objectContextGroupsQuery } from '../../../../api/queries';
import { contextGroupEdit } from '../../../../config/paths';

interface RuleMembership {
  groupId: string;
  ruleId: string;
  ruleName: string;
  ruleSlug: string;
  title: string;
}

function ContextGroupChip({ membership }: { membership: RuleMembership }) {
  const className = cn(
    'motion-colors inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs font-medium',
    'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
  );
  const content = (
    <>
      <Users className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {membership.title || membership.ruleName}
      </span>
    </>
  );

  // Link to the rule (a member may belong to several materialized groups under
  // one rule; the rule page is the stable target — see the folding in the
  // parent's `byRule` map).
  return membership.ruleId ? (
    <Link to={contextGroupEdit(membership.ruleId)} className={className}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  );
}

export function ObjectContextGroupsSection({
  datasourceId,
  objectId,
}: {
  datasourceId: string;
  objectId: string;
}) {
  const api = useDatastore();
  const {
    data: memberships,
    isLoading: loading,
    error,
  } = useQuery(objectContextGroupsQuery(api, datasourceId, objectId));

  const ruleMemberships = useMemo(() => {
    const byRule = new Map<string, RuleMembership>();
    for (const m of memberships ?? []) {
      byRule.set(m.ruleId, {
        groupId: m.groupId,
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        ruleSlug: m.ruleSlug,
        title: m.title,
      });
    }
    return [...byRule.values()].sort((a, b) =>
      a.ruleName.localeCompare(b.ruleName),
    );
  }, [memberships]);

  const isEmpty = !loading && !error && ruleMemberships.length === 0;

  // Nothing to show (and nothing pending) — omit the section entirely rather
  // than render an empty "Context groups" heading.
  if (isEmpty) {
    return null;
  }

  return (
    <DetailSection
      title="Context groups"
      count={loading ? undefined : ruleMemberships.length}
    >
      {loading ? (
        <Spinner className="size-3 text-muted-foreground" />
      ) : error ? (
        <span className="text-xs text-destructive">{error.message}</span>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {ruleMemberships.map(membership => (
            <ContextGroupChip
              key={
                membership.groupId || membership.ruleId || membership.ruleName
              }
              membership={membership}
            />
          ))}
        </div>
      )}
    </DetailSection>
  );
}
