import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithQuery as render } from '../../../../test-utils';

import { describe, expect, it, vi } from 'vitest';
import type { Integration } from '../../../../api/workflow/workflow-client';
import { ChainedSourceConfig } from './chained-source-config';

const getIntegration = vi.fn(() => new Promise(() => {}));

vi.mock('./source-config', async () => {
  const { Button } = await import('@roadiehq/ui/button');

  return {
    SourceConfig: ({
      sourceType,
      onIntegrationSelect,
    }: {
      sourceType?: string | null;
      onIntegrationSelect?: (
        integrationId: string,
        integration: unknown,
      ) => void;
    }) => (
      <div>
        <span data-testid="source-config-type">{sourceType ?? 'null'}</span>
        <Button
          type="button"
          onClick={() =>
            onIntegrationSelect?.('http-int', {
              id: 'http-int',
              name: 'GitHub',
              host: 'https://api.github.com',
              backendType: 'http',
            })
          }
        >
          Select HTTP Integration
        </Button>
        <Button
          type="button"
          onClick={() =>
            onIntegrationSelect?.('aws-int', {
              id: 'aws-int',
              name: 'AWS',
              host: 'https://aws.amazon.com',
              backendType: 'aws',
            })
          }
        >
          Select AWS Integration
        </Button>
      </div>
    ),
    SourceConfigType: null,
  };
});

vi.mock('../data-source-editor-context', () => ({
  useDataSourceEditorContext: () => ({
    workflowApi: {
      integrations: {
        get: getIntegration,
      },
    },
  }),
}));

describe('ChainedSourceConfig', () => {
  it('clears stale http pagination-related fields when switching integrations', () => {
    const onChange = vi.fn();

    render(
      <ChainedSourceConfig
        config={{
          integrationId: 'old-int',
          backendType: 'http',
          mode: 'graphql',
          path: '/old',
          pathTemplate: '/old/{id}',
          pathParams: { id: '123' },
          method: 'POST',
          headers: [{ key: 'x-test', value: '1' }],
          body: { foo: 'bar' },
          arrayExpression: '$.items',
          objectIdExpression: 'node.id',
          pagination: {
            type: 'page',
            pageParam: 'page',
            perPageParam: 'per_page',
            perPage: 50,
            startPage: 2,
          },
          paginationMode: 'custom',
          effectivePaginationDefault: {
            type: 'cursor',
            cursorParam: 'cursor',
            nextCursorExpression: 'next',
          },
          graphqlQuery: 'query Test { viewer { login } }',
          graphqlVariables: '{"foo":"bar"}',
        }}
        sourceType="http"
        onChange={onChange}
        previousOutput={[]}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Select HTTP Integration' }),
    );

    expect(onChange).toHaveBeenCalledWith('integrationId', 'http-int');
    expect(onChange).toHaveBeenCalledWith('backendType', 'http');
    expect(onChange).toHaveBeenCalledWith('path', '');
    expect(onChange).toHaveBeenCalledWith('pathTemplate', undefined);
    expect(onChange).toHaveBeenCalledWith('pathParams', undefined);
    expect(onChange).toHaveBeenCalledWith('body', undefined);
    expect(onChange).toHaveBeenCalledWith('pagination', undefined);
    expect(onChange).toHaveBeenCalledWith('paginationMode', 'inherit');
    expect(onChange).toHaveBeenCalledWith(
      'effectivePaginationDefault',
      undefined,
    );
    expect(onChange).toHaveBeenCalledWith('mode', undefined);
    expect(onChange).toHaveBeenCalledWith('graphqlQuery', undefined);
    expect(onChange).toHaveBeenCalledWith('graphqlVariables', undefined);
  });

  it('uses AWS source config when integration is AWS before parent sourceType resolves', () => {
    render(
      <ChainedSourceConfig
        config={{ integrationId: 'aws-int' }}
        sourceType={null}
        onChange={vi.fn()}
        // Only the fields the AWS config panel reads are set.
        integration={
          {
            id: 'aws-int',
            name: 'AWS',
            host: 'https://aws.amazon.com',
            backendType: 'aws',
          } as Integration
        }
      />,
    );

    expect(screen.getByTestId('source-config-type')).toHaveTextContent('aws');
  });
});
