import React, { useMemo } from 'react';
import { graphql } from 'cm6-graphql';
import { Kind, parse, type SelectionSetNode } from 'graphql';
import { Button } from '@roadiehq/ui/button';
import { Editor } from '@roadiehq/ui/editor';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { JsonEditor } from '../../../common/request-editor';
import type { HttpIntegrationSourceConfig } from '../data-source-editor-context';

function findNodesPath(
  selectionSet: SelectionSetNode,
  prefix: string[],
): string[] | null {
  for (const sel of selectionSet.selections) {
    if (sel.kind !== Kind.FIELD || !sel.selectionSet) continue;
    const segment = sel.alias?.value ?? sel.name.value;
    const childPath = [...prefix, segment];
    if (sel.name.value === 'nodes') {
      return childPath;
    }
    const inner = findNodesPath(sel.selectionSet, childPath);
    if (inner) return inner;
  }
  return null;
}

function suggestArrayExpression(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  let doc;
  try {
    doc = parse(trimmed);
  } catch {
    return null;
  }
  const op = doc.definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
  if (!op || op.kind !== Kind.OPERATION_DEFINITION) return null;
  const path = findNodesPath(op.selectionSet, []);
  return path ? `data.${path.join('.')}` : null;
}

interface GraphqlSourceFieldsProps {
  config: HttpIntegrationSourceConfig;
  onChange: (key: string, value: unknown) => void;
}

const QUERY_EXTENSIONS = [graphql()];

export function GraphqlSourceFields({
  config,
  onChange,
}: GraphqlSourceFieldsProps) {
  const query = config.graphqlQuery ?? '';
  const variables = config.graphqlVariables ?? '';
  // Bump when the parent programmatically replaces config (e.g. switching
  // integration) so Editor adopts the cleared value over in-flight edits.
  const editorResetKey = config.integrationId ?? 'none';

  const variablesError = useMemo(() => {
    const trimmed = variables.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return 'Variables must be a JSON object';
      }
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
  }, [variables]);

  const suggestedArrayExpression = useMemo(
    () => suggestArrayExpression(query),
    [query],
  );

  const queryError = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const doc = parse(trimmed);
      const operations = doc.definitions.filter(
        d => d.kind === Kind.OPERATION_DEFINITION,
      );
      if (operations.length > 1) {
        return 'Multi-operation documents are not supported — please include only one operation.';
      }
      return null;
    } catch {
      return null;
    }
  }, [query]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="graphql-query"
          className="mb-1 block text-sm font-medium"
        >
          Query
        </label>
        <Editor
          id="graphql-query"
          aria-label="Query"
          value={query}
          height="220px"
          minHeight="120px"
          resizable
          extensions={QUERY_EXTENSIONS}
          onChange={value => onChange('graphqlQuery', value)}
          resetKey={editorResetKey}
          setup={{ highlightActiveLine: true }}
          data-testid="graphql-query"
        />
        {queryError && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {queryError}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="graphql-variables"
          className="mb-1 block text-sm font-medium"
        >
          Variables
        </label>
        <JsonEditor
          id="graphql-variables"
          ariaLabel="Variables (JSON)"
          value={variables}
          onChange={value => onChange('graphqlVariables', value)}
          resetKey={editorResetKey}
          error={
            variablesError
              ? `Variables JSON is invalid: ${variablesError}`
              : null
          }
          placeholder='{\n  "login": "roadiehq"\n}'
          data-testid="graphql-variables"
        />
      </div>

      <div>
        <OutlinedInput
          label="Array Expression"
          value={config.arrayExpression ?? '$'}
          onChange={e => onChange('arrayExpression', e.target.value)}
          placeholder="$"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          JSONata expression to extract the array of items from the response
        </p>
        {suggestedArrayExpression !== null &&
          suggestedArrayExpression !== (config.arrayExpression ?? '') && (
            <p className="mt-1 text-xs text-muted-foreground">
              Suggested:{' '}
              <Button
                type="button"
                variant="link"
                onClick={() =>
                  onChange('arrayExpression', suggestedArrayExpression)
                }
                className="h-auto p-0 font-mono text-xs"
              >
                {suggestedArrayExpression}
              </Button>
            </p>
          )}
      </div>
    </div>
  );
}
