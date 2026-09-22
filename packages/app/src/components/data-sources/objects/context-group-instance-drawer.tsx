/*
 * Copyright 2025 Larder Software Limited
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

import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  DetailDrawer,
  DetailFields,
  DetailSection,
  StatBadges,
  type StatBadge,
} from '../../common';
import { useDatastore } from '../../../api';
import { contextGroupInstanceQuery } from '../../../api/queries';
import {
  contextGroupDetail,
  contextGroupInstance,
  objectDetail,
} from '../../../config/paths';
import { useDataSources } from '../use-data-sources';

const MEMBER_SAMPLE_SIZE = 24;
const RELATIONSHIP_SAMPLE_SIZE = 10;

const countFormatter = new Intl.NumberFormat();

export interface ContextGroupInstanceDrawerProps {
  /** The materialized group to show; undefined renders nothing while closed. */
  groupId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** See {@link ObjectDetailDrawerProps.keepOpenSelector}. */
  keepOpenSelector?: string;
}

/**
 * Detail drawer for a materialized context-group row in the Datastore table —
 * the cheap look the row-body click owes every listing row. Mirrors the routed
 * instance page (`context-group-instance-page.tsx`): same title, rule crumb and
 * Users icon, with the full page reachable via the drawer's "Open" action.
 */
export function ContextGroupInstanceDrawer({
  groupId,
  open,
  onOpenChange,
  keepOpenSelector,
}: ContextGroupInstanceDrawerProps) {
  const api = useDatastore();
  const { dataSources } = useDataSources({ skipExecutions: true });

  const {
    data: bundle,
    isLoading,
    error,
  } = useQuery({
    ...contextGroupInstanceQuery(api, groupId ?? '', {
      memberLimit: MEMBER_SAMPLE_SIZE,
      relationshipLimit: RELATIONSHIP_SAMPLE_SIZE,
    }),
    enabled: open && !!groupId,
  });

  const dataSourceNames = useMemo(
    () => new Map(dataSources.map(ds => [ds.id, ds.name])),
    [dataSources],
  );

  const totalMembers = bundle?.totalMembers ?? bundle?.members.length ?? 0;
  const stats: StatBadge[] = bundle
    ? [
        { label: 'Records', value: countFormatter.format(totalMembers) },
        {
          label: 'Internal relationships',
          value: countFormatter.format(
            bundle.totalInternalRelationships ??
              bundle.internalRelationships.length,
          ),
        },
        {
          label: 'External relationships',
          value: countFormatter.format(
            bundle.totalExternalRelationships ??
              bundle.externalRelationships.length,
          ),
        },
      ]
    : [];

  const hiddenMembers = bundle
    ? Math.max(0, totalMembers - bundle.members.length)
    : 0;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={bundle?.title ?? 'Context group'}
      subtitle={bundle?.ruleName}
      icon={
        <IntegrationIconFrame size="group">
          <Users className="size-4 shrink-0 text-primary" />
        </IntegrationIconFrame>
      }
      editAction={
        groupId
          ? { type: 'link', href: contextGroupInstance(groupId) }
          : undefined
      }
      editLabel="Open"
      keepOpenSelector={keepOpenSelector}
      loading={open && isLoading}
      error={
        error?.message ??
        (open && !isLoading && !error && bundle === null
          ? 'Context group not found.'
          : undefined)
      }
    >
      {bundle && (
        <>
          <DetailSection title="Details">
            <StatBadges stats={stats} />
            <DetailFields
              fields={[
                {
                  label: 'Rule',
                  value: (
                    <Link
                      to={contextGroupDetail(bundle.ruleId)}
                      className="motion-colors truncate text-surface-foreground hover:underline"
                    >
                      {bundle.ruleName}
                    </Link>
                  ),
                },
                {
                  label: 'Group ID',
                  value: (
                    <span className="block truncate font-mono text-xs">
                      {bundle.id}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          <DetailSection title="Records" count={totalMembers}>
            <div className="flex flex-col gap-1">
              {bundle.members.map(member => (
                <Link
                  key={`${member.datasourceId}:${member.objectId}`}
                  to={objectDetail(member.datasourceId, member.objectId)}
                  className="motion-colors flex min-w-0 items-baseline justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
                >
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {member.presentation.title || member.objectId}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dataSourceNames.get(member.datasourceId) ??
                      member.datasourceId}
                  </span>
                </Link>
              ))}
            </div>
            {hiddenMembers > 0 ? (
              <p className="text-xs text-muted-foreground">
                +{countFormatter.format(hiddenMembers)} more on the full page.
              </p>
            ) : null}
          </DetailSection>
        </>
      )}
    </DetailDrawer>
  );
}
