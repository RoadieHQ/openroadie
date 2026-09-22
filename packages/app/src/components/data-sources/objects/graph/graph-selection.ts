/** One end of a selected relationship, resolved from the loaded graph. An
 * endpoint is an object node, or — with context groups collapsed — a group
 * node standing in for its members. */
export type GraphSelectedEndpoint =
  | {
      kind?: 'object';
      datasourceId: string;
      objectId: string;
      label: string;
    }
  | {
      kind: 'group';
      groupId: string;
      label: string;
      ruleName: string;
    };

export function isGroupSelectedEndpoint(
  endpoint: GraphSelectedEndpoint,
): endpoint is Extract<GraphSelectedEndpoint, { kind: 'group' }> {
  return endpoint.kind === 'group';
}

/** One member relationship folded into an aggregated (group-touching) edge. */
export interface GraphSelectedRelationshipMember {
  id: string;
  relationshipType: string;
  /** Materializing rule, when the edge is rule-created (null = direct). */
  ruleId: string | null;
  source: { datasourceId: string; objectId: string; label: string };
  target: { datasourceId: string; objectId: string; label: string };
}

/**
 * A relation the user clicked in a graph canvas. Carries everything the
 * relationship drawer renders, captured at click time from the loaded
 * graph — so the drawer stays valid even if a refetch drops the edge.
 */
export interface GraphSelectedRelationship {
  id: string;
  relationshipType: string;
  /** Materializing rule, when the edge is rule-created (null = direct). */
  ruleId: string | null;
  source: GraphSelectedEndpoint;
  target: GraphSelectedEndpoint;
  /** Present when the clicked edge aggregates member relationships behind a
   * collapsed context-group node. */
  members?: GraphSelectedRelationshipMember[];
}

export function isDirectSelectedRelationship(
  relationship: GraphSelectedRelationship,
): boolean {
  return relationship.ruleId === null && !relationship.members;
}
