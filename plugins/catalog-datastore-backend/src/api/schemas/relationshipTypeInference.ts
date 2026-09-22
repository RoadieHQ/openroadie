import type { RelationshipSuggestionKind } from '@roadiehq/catalog-datastore-common';

export interface InferredRelationshipType {
  relationshipType: string;
  reciprocalRelationshipType: string;
}

interface HeuristicEntry {
  tokens: string[];
  relationshipType: string;
  reciprocalRelationshipType: string;
}

const DEFAULT_INFERENCE: InferredRelationshipType = {
  relationshipType: 'relatedTo',
  reciprocalRelationshipType: 'relatesTo',
};

// Trailing identifier-style segments that don't carry semantic meaning on their
// own — when a path ends in one of these, prefer the parent segment for
// matching (e.g. `$.owner.login` → match on `owner`, not `login`).
const IDENTIFIER_LEAF_SEGMENTS = new Set([
  'login',
  'email',
  'id',
  'name',
  'slug',
  'tag',
  'ref',
  'uuid',
  'username',
  'handle',
  'value',
]);

const HEURISTIC_TABLE: HeuristicEntry[] = [
  {
    tokens: [
      'owner',
      'owners',
      'owned_by',
      'ownedby',
      'ownerlogin',
      'owneremail',
    ],
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: 'ownerOf',
  },
  {
    tokens: [
      'author',
      'authoredby',
      'authored_by',
      'createdby',
      'created_by',
      'reporter',
    ],
    relationshipType: 'authoredBy',
    reciprocalRelationshipType: 'authorOf',
  },
  {
    tokens: ['assignee', 'assignedto', 'assigned_to'],
    relationshipType: 'assignedTo',
    reciprocalRelationshipType: 'assigneeOf',
  },
  {
    tokens: ['maintainer', 'maintainedby', 'maintained_by'],
    relationshipType: 'maintainedBy',
    reciprocalRelationshipType: 'maintainerOf',
  },
  {
    tokens: ['manager', 'reportsto', 'reports_to'],
    relationshipType: 'reportsTo',
    reciprocalRelationshipType: 'manages',
  },
  {
    tokens: [
      'member',
      'members',
      'memberof',
      'team',
      'teamid',
      'team_slug',
      'teamslug',
    ],
    relationshipType: 'memberOf',
    reciprocalRelationshipType: 'hasMember',
  },
  {
    tokens: ['parent', 'parentid', 'parent_of', 'parentof'],
    relationshipType: 'childOf',
    reciprocalRelationshipType: 'parentOf',
  },
  {
    tokens: [
      'dependson',
      'depends_on',
      'dependencies',
      'dependency',
      'requires',
    ],
    relationshipType: 'dependsOn',
    reciprocalRelationshipType: 'dependencyOf',
  },
  {
    tokens: ['consumer', 'consumes'],
    relationshipType: 'consumes',
    reciprocalRelationshipType: 'consumedBy',
  },
  {
    tokens: ['provider', 'provides'],
    relationshipType: 'provides',
    reciprocalRelationshipType: 'providedBy',
  },
  {
    tokens: [
      'partof',
      'part_of',
      'belongsto',
      'belongs_to',
      'project',
      'projectid',
      'repository',
      'repo',
      'repoid',
    ],
    relationshipType: 'partOf',
    reciprocalRelationshipType: 'hasPart',
  },
];

const TOKEN_LOOKUP: Map<string, InferredRelationshipType> = (() => {
  const map = new Map<string, InferredRelationshipType>();
  for (const entry of HEURISTIC_TABLE) {
    for (const token of entry.tokens) {
      map.set(token, {
        relationshipType: entry.relationshipType,
        reciprocalRelationshipType: entry.reciprocalRelationshipType,
      });
    }
  }
  return map;
})();

function normaliseSegment(segment: string): string {
  return segment.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function pathSegments(fieldExpression: string): string[] {
  // Strip JSONPath bracket qualifiers (`[name="x"]`, `[*]`) and split on `.`.
  // Drop the leading `$` if present.
  const withoutBrackets = fieldExpression.replace(/\[[^\]]*\]/g, '');
  return withoutBrackets
    .split('.')
    .map(part => part.trim())
    .filter(part => part.length > 0 && part !== '$');
}

function candidateSegments(fieldExpression: string): string[] {
  const segments = pathSegments(fieldExpression);
  if (segments.length === 0) {
    return [];
  }
  const candidates: string[] = [];
  const lastIndex = segments.length - 1;
  const last = normaliseSegment(segments[lastIndex]);
  if (IDENTIFIER_LEAF_SEGMENTS.has(last) && lastIndex > 0) {
    const parent = normaliseSegment(segments[lastIndex - 1]);
    if (parent) {
      candidates.push(parent);
    }
  }
  if (last && !candidates.includes(last)) {
    candidates.push(last);
  }
  return candidates;
}

function lookup(segments: string[]): InferredRelationshipType | undefined {
  for (const segment of segments) {
    const direct = TOKEN_LOOKUP.get(segment);
    if (direct) {
      return direct;
    }
    // Also try a hyphen/underscore-stripped form so `owned-by` matches.
    const collapsed = segment.replace(/[_-]/g, '');
    if (collapsed !== segment) {
      const collapsedHit = TOKEN_LOOKUP.get(collapsed);
      if (collapsedHit) {
        return collapsedHit;
      }
    }
  }
  return undefined;
}

export function inferRelationshipType(args: {
  sourceField: string;
  targetField: string;
  suggestionKind: RelationshipSuggestionKind;
}): InferredRelationshipType {
  if (args.suggestionKind === 'identity') {
    return DEFAULT_INFERENCE;
  }
  const sourceHit = lookup(candidateSegments(args.sourceField));
  if (sourceHit) {
    return sourceHit;
  }
  const targetHit = lookup(candidateSegments(args.targetField));
  if (targetHit) {
    return targetHit;
  }
  return DEFAULT_INFERENCE;
}
