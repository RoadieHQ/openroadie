import {
  Kind,
  parse,
  type FieldNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';

export interface GraphqlCursorSuggestion {
  cursorVariable: string;
  nextCursorExpression: string;
  hasNextPageExpression?: string;
}

interface ConnectionMatch {
  field: FieldNode;
  path: string[];
}

function findConnectionField(
  selectionSet: SelectionSetNode,
  prefix: string[],
): ConnectionMatch | null {
  for (const sel of selectionSet.selections) {
    if (sel.kind !== Kind.FIELD || !sel.selectionSet) continue;
    const segment = sel.alias?.value ?? sel.name.value;
    const childPath = [...prefix, segment];

    const pageInfo = sel.selectionSet.selections.find(
      (s): s is FieldNode =>
        s.kind === Kind.FIELD && s.name.value === 'pageInfo',
    );
    if (pageInfo?.selectionSet) {
      const hasEndCursor = pageInfo.selectionSet.selections.some(
        s => s.kind === Kind.FIELD && s.name.value === 'endCursor',
      );
      if (hasEndCursor) {
        return { field: sel, path: childPath };
      }
    }

    const inner = findConnectionField(sel.selectionSet, childPath);
    if (inner) return inner;
  }
  return null;
}

export function getDeclaredVariableNames(query: string): Set<string> | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  let doc;
  try {
    doc = parse(trimmed);
  } catch {
    return null;
  }
  const op = doc.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (!op) return null;
  return new Set(
    (op.variableDefinitions ?? []).map(v => v.variable.name.value),
  );
}

export function suggestGraphqlCursorPagination(
  query: string,
): GraphqlCursorSuggestion | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  let doc;
  try {
    doc = parse(trimmed);
  } catch {
    return null;
  }

  const op = doc.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (!op) return null;

  const match = findConnectionField(op.selectionSet, []);
  if (!match) return null;

  const pageInfo = match.field.selectionSet?.selections.find(
    (s): s is FieldNode => s.kind === Kind.FIELD && s.name.value === 'pageInfo',
  );
  const hasHasNextPage =
    pageInfo?.selectionSet?.selections.some(
      s => s.kind === Kind.FIELD && s.name.value === 'hasNextPage',
    ) ?? false;

  const pathPrefix = `data.${match.path.join('.')}`;

  const suggestion: GraphqlCursorSuggestion = {
    cursorVariable: 'after',
    nextCursorExpression: `${pathPrefix}.pageInfo.endCursor`,
  };
  if (hasHasNextPage) {
    suggestion.hasNextPageExpression = `${pathPrefix}.pageInfo.hasNextPage`;
  }

  for (const arg of match.field.arguments ?? []) {
    if (arg.name.value === 'after' && arg.value.kind === Kind.VARIABLE) {
      suggestion.cursorVariable = arg.value.name.value;
    }
  }

  return suggestion;
}
