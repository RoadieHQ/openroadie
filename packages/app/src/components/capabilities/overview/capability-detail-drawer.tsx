import { useMemo } from 'react';
import type { ComponentType } from 'react';
import { Link } from 'react-router';
import { Sparkles, Database, Zap, Boxes, HelpCircle } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import {
  DetailDrawer,
  DetailSection,
  DetailFields,
  PreviewTable,
  formatRelative,
  formatAbsolute,
  type PreviewColumn,
} from '../../common';
import {
  actionDetail,
  capabilityDetail,
  contextGroupEdit,
  dataSourceDetail,
} from '../../../config/paths';
import type { Capability } from '../../../api';
import { useCapabilityReferences } from '../editor/use-capability-references';
import {
  extractReferences,
  referenceKey,
  REFERENCE_TYPE_LABELS,
  type CapabilityReferenceType,
} from '../editor/references';
import { BrokenReferenceBadge } from './capabilities-columns';

const REFERENCE_TYPE_ICON: Record<
  CapabilityReferenceType,
  ComponentType<{ className?: string }>
> = {
  datasource: Database,
  action: Zap,
  'context-group': Boxes,
  capability: Sparkles,
};

/** A `@type:slug` reference resolved against the resources that exist. */
interface ResolvedReference {
  type: CapabilityReferenceType;
  slug: string;
  /** Display name of the target resource, or `undefined` when it's dangling. */
  name?: string;
  /** Target id (for linking); absent when dangling. */
  id?: string;
  broken: boolean;
}

/** Detail route for a resolved reference, by type. */
function referenceHref(ref: ResolvedReference): string | undefined {
  if (ref.broken || !ref.id) return undefined;
  switch (ref.type) {
    case 'datasource':
      return dataSourceDetail(ref.id);
    case 'action':
      return actionDetail(ref.id);
    case 'context-group':
      return contextGroupEdit(ref.id);
    case 'capability':
      return capabilityDetail(ref.id);
  }
}

const REFERENCE_COLUMNS: PreviewColumn<ResolvedReference>[] = [
  {
    key: 'reference',
    header: 'Reference',
    className: 'align-top',
    cell: ref => {
      const Icon = ref.broken ? HelpCircle : REFERENCE_TYPE_ICON[ref.type];
      const href = referenceHref(ref);
      const label = (
        <span
          className={cn(
            'truncate',
            ref.broken ? 'text-warning' : 'text-foreground',
          )}
          title={ref.broken ? `Missing: ${ref.slug}` : ref.name}
        >
          {ref.name ?? ref.slug}
        </span>
      );
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            className={cn(
              'size-3.5 shrink-0',
              ref.broken ? 'text-warning' : 'text-muted-foreground',
            )}
          />
          {href ? (
            <Link to={href} className="motion-colors min-w-0 hover:underline">
              {label}
            </Link>
          ) : (
            label
          )}
        </span>
      );
    },
  },
  {
    key: 'type',
    header: 'Type',
    className: 'w-2/5 align-top text-muted-foreground',
    cell: ref => (
      <span className="truncate">
        {ref.broken ? (
          <span className="text-warning">Missing {ref.type}</span>
        ) : (
          REFERENCE_TYPE_LABELS[ref.type]
        )}
      </span>
    ),
  },
];

export interface CapabilityDetailDrawerProps {
  /**
   * URL-selected id. Kept in the props for parity with the other detail drawers
   * (and future deep-link support); the list row already carries every field we
   * render, so nothing is fetched by id today.
   */
  capabilityId: string | null;
  /** The row being previewed, from the list. `undefined` while none selected. */
  capability: Capability | undefined;
  open: boolean;
  /** True while the capabilities list is still loading for a deep-linked id. */
  listLoading?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail drawer for a Capabilities row. The list row already carries every base
 * field (description, instructions, version, timestamps), so nothing is fetched
 * here — the only extra work is cross-checking the instruction's `@type:slug`
 * references against the resources that exist (via {@link useCapabilityReferences})
 * to resolve display names and flag dangling references.
 */
export function CapabilityDetailDrawer({
  capabilityId,
  capability,
  open,
  listLoading = false,
  onOpenChange,
}: CapabilityDetailDrawerProps) {
  const { byKey, loading: referencesLoading } = useCapabilityReferences();

  const references = useMemo<ResolvedReference[]>(() => {
    if (!capability) return [];
    return extractReferences(capability.instructions).map(ref => {
      const resolved = byKey.get(referenceKey(ref.type, ref.slug));
      return {
        type: ref.type,
        slug: ref.slug,
        name: resolved?.name,
        id: resolved?.id,
        broken: !resolved,
      };
    });
  }, [capability, byKey]);

  // Don't flag anything while the reference resources are still loading —
  // otherwise every reference looks broken (mirrors the overview list).
  const brokenReferences = useMemo(
    () => (referencesLoading ? [] : references.filter(ref => ref.broken)),
    [references, referencesLoading],
  );

  const notFound = open && capabilityId != null && !capability && !listLoading;
  const loading = open && listLoading && capabilityId != null && !capability;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={capability?.name ?? 'Capability'}
      subtitle={capability?.slug}
      icon={
        <IntegrationIconFrame size="group">
          <Sparkles className="size-4 shrink-0 text-primary" />
        </IntegrationIconFrame>
      }
      status={
        capability ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outlineMuted">v{capability.currentVersion}</Badge>
            {brokenReferences.length > 0 && (
              <BrokenReferenceBadge broken={brokenReferences} />
            )}
          </span>
        ) : undefined
      }
      editAction={
        capability
          ? {
              type: 'link',
              href: capabilityDetail(capability.id),
              viewTransition: true,
            }
          : undefined
      }
      loading={loading}
      error={notFound ? 'Capability not found.' : undefined}
    >
      {capability && (
        <>
          <DetailSection title="Details">
            <DetailFields
              fields={[
                {
                  label: 'Created',
                  value: (
                    <span title={formatAbsolute(capability.createdAt)}>
                      {formatRelative(capability.createdAt)}
                    </span>
                  ),
                },
                {
                  label: 'Updated',
                  value: (
                    <span title={formatAbsolute(capability.updatedAt)}>
                      {formatRelative(capability.updatedAt)}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          {capability.description && (
            <DetailSection title="Description">
              <p className="text-sm text-surface-foreground">
                {capability.description}
              </p>
            </DetailSection>
          )}

          {capability.instructions.trim() && (
            <DetailSection title="Instructions">
              {/* Raw instruction markdown is written for agents, so preview it
                  as a muted, clamped block rather than rendering it as prose. */}
              <p className="line-clamp-[12] text-sm break-words whitespace-pre-wrap text-muted-foreground">
                {capability.instructions}
              </p>
            </DetailSection>
          )}

          {references.length > 0 && (
            <DetailSection title="References" count={references.length}>
              <PreviewTable
                columns={REFERENCE_COLUMNS}
                rows={references}
                getRowId={ref => referenceKey(ref.type, ref.slug)}
                rowHref={referenceHref}
                loading={referencesLoading}
                skeletonRows={2}
                emptyMessage="No references."
              />
            </DetailSection>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
