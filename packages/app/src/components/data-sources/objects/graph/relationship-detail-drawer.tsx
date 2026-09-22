import { ArrowDown, ArrowRight, Users, Waypoints } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { DetailDrawer, DetailFields, DetailSection } from '../../../common';
import { DirectRelationshipBadge } from '../../direct-relationship-badge';
import { humanizeRelationshipTypeLabel } from '../../humanize-relationship-type';
import { useRelationshipRuleNames } from '../../use-relationship-rule-names';
import {
  isDirectSelectedRelationship,
  isGroupSelectedEndpoint,
  type GraphSelectedEndpoint,
  type GraphSelectedRelationship,
  type GraphSelectedRelationshipMember,
} from './graph-selection';

function EndpointRow({
  endpoint,
  dataSourceNames,
  onOpen,
  onOpenGroup,
}: {
  endpoint: GraphSelectedEndpoint;
  dataSourceNames: Map<string, string>;
  onOpen: (endpoint: GraphSelectedEndpoint) => void;
  onOpenGroup?: (groupId: string) => void;
}) {
  const group = isGroupSelectedEndpoint(endpoint);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        if (group) {
          onOpenGroup?.(endpoint.groupId);
        } else {
          onOpen(endpoint);
        }
      }}
      className="h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left"
    >
      <span className="flex w-full min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
        {group && <Users className="size-3.5 shrink-0 text-primary" />}
        <span className="min-w-0 truncate">{endpoint.label}</span>
      </span>
      <span className="w-full truncate text-xs font-normal text-muted-foreground">
        {group
          ? endpoint.ruleName
          : (dataSourceNames.get(endpoint.datasourceId) ??
            endpoint.datasourceId)}
      </span>
    </Button>
  );
}

function MemberRelationshipRow({
  member,
  onOpenObject,
}: {
  member: GraphSelectedRelationshipMember;
  onOpenObject: (endpoint: GraphSelectedEndpoint) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-w-0 flex-1 justify-start px-1 py-0.5 text-xs font-medium"
        onClick={() => onOpenObject(member.source)}
      >
        <span className="min-w-0 truncate">{member.source.label}</span>
      </Button>
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-w-0 flex-1 justify-start px-1 py-0.5 text-xs font-medium"
        onClick={() => onOpenObject(member.target)}
      >
        <span className="min-w-0 truncate">{member.target.label}</span>
      </Button>
    </div>
  );
}

/**
 * Detail drawer for a relation clicked in a graph canvas: the relationship's
 * type and origin, plus the two things it connects — objects open their own
 * summary drawer, collapsed context-group endpoints open the group drawer.
 * An aggregated (group-touching) edge additionally lists the member
 * relationships folded into it.
 */
export function RelationshipDetailDrawer({
  relationship,
  open,
  onOpenChange,
  dataSourceNames,
  onOpenObject,
  onOpenGroup,
  keepOpenSelector,
}: {
  relationship: GraphSelectedRelationship | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataSourceNames: Map<string, string>;
  /** Swap to the clicked endpoint's object drawer. */
  onOpenObject: (endpoint: GraphSelectedEndpoint) => void;
  /** Swap to the clicked group endpoint's group drawer. */
  onOpenGroup?: (groupId: string) => void;
  keepOpenSelector?: string;
}) {
  const ruleNames = useRelationshipRuleNames();
  const direct = relationship
    ? isDirectSelectedRelationship(relationship)
    : false;
  const members = relationship?.members;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        relationship
          ? humanizeRelationshipTypeLabel(relationship.relationshipType)
          : 'Relationship'
      }
      subtitle="Relationship"
      status={direct ? <DirectRelationshipBadge /> : undefined}
      icon={
        <IntegrationIconFrame size="group">
          <Waypoints className="size-4 shrink-0 text-muted-foreground" />
        </IntegrationIconFrame>
      }
      keepOpenSelector={keepOpenSelector}
    >
      {relationship && (
        <>
          <DetailSection title="Connects">
            <div className="flex flex-col gap-1.5">
              <EndpointRow
                endpoint={relationship.source}
                dataSourceNames={dataSourceNames}
                onOpen={onOpenObject}
                onOpenGroup={onOpenGroup}
              />
              <div className="flex items-center gap-1.5 pl-3 text-xs text-muted-foreground">
                <ArrowDown className="size-3.5 shrink-0" />
                <span className="truncate">
                  {humanizeRelationshipTypeLabel(relationship.relationshipType)}
                  {members && members.length > 1 ? ` ×${members.length}` : ''}
                </span>
              </div>
              <EndpointRow
                endpoint={relationship.target}
                dataSourceNames={dataSourceNames}
                onOpen={onOpenObject}
                onOpenGroup={onOpenGroup}
              />
            </div>
          </DetailSection>

          <DetailSection title="Details">
            <DetailFields
              fields={[
                {
                  label: 'Type',
                  value: (
                    <span
                      className="block truncate"
                      title={relationship.relationshipType}
                    >
                      {relationship.relationshipType}
                    </span>
                  ),
                },
                {
                  label: 'Origin',
                  value: members
                    ? `Aggregated from ${members.length} relationship${
                        members.length === 1 ? '' : 's'
                      }`
                    : direct
                      ? 'Direct relationship'
                      : `Rule: ${
                          ruleNames.get(relationship.ruleId ?? '') ??
                          relationship.ruleId ??
                          'unknown'
                        }`,
                },
              ]}
            />
          </DetailSection>

          {members && (
            <DetailSection title="Relationships" count={members.length}>
              <div className="flex flex-col gap-1.5">
                {members.map(member => (
                  <MemberRelationshipRow
                    key={member.id}
                    member={member}
                    onOpenObject={onOpenObject}
                  />
                ))}
              </div>
            </DetailSection>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
