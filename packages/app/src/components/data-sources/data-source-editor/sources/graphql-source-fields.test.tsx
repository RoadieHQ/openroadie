import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '@roadiehq/ui/textarea';
import { GraphqlSourceFields } from './graphql-source-fields';
import type { HttpIntegrationSourceConfig } from '../data-source-editor-context';

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    id,
    'data-testid': dataTestId,
  }: {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    'data-testid'?: string;
  }) => (
    <Textarea
      id={id}
      data-testid={dataTestId}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@codemirror/lang-json', () => ({
  json: () => [],
  jsonParseLinter: () => () => [],
}));
vi.mock('@codemirror/lint', () => ({ linter: () => [] }));
vi.mock('cm6-graphql', () => ({ graphql: () => [] }));

function makeConfig(
  overrides: Partial<HttpIntegrationSourceConfig> = {},
): HttpIntegrationSourceConfig {
  return {
    integrationId: 'i-1',
    mode: 'graphql',
    method: 'POST',
    path: '/graphql',
    arrayExpression: 'data',
    graphqlQuery: '',
    graphqlVariables: '',
    ...overrides,
  };
}

describe('GraphqlSourceFields', () => {
  it('adopts a programmatic query clear when the integration changes', () => {
    const { rerender } = render(
      <GraphqlSourceFields
        config={makeConfig({
          integrationId: 'i-1',
          graphqlQuery: 'query GetUser { viewer { id } }',
        })}
        onChange={() => {}}
      />,
    );

    const editor = screen.getByTestId('graphql-query');
    fireEvent.focus(editor);
    fireEvent.change(editor, {
      target: { value: 'query Draft { viewer { login } }' },
    });
    expect(editor).toHaveValue('query Draft { viewer { login } }');

    rerender(
      <GraphqlSourceFields
        config={makeConfig({
          integrationId: 'i-2',
          graphqlQuery: '',
          graphqlVariables: '',
        })}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId('graphql-query')).toHaveValue('');
    expect(screen.getByTestId('graphql-variables')).toHaveValue('');
  });

  it('shows no error for a single-operation query', () => {
    render(
      <GraphqlSourceFields
        config={makeConfig({
          graphqlQuery: 'query GetUser { viewer { id } }',
        })}
        onChange={() => {}}
      />,
    );

    expect(
      screen.queryByText(/multi-operation documents are not supported/i),
    ).not.toBeInTheDocument();
  });

  it('shows an inline error for a multi-operation query', () => {
    render(
      <GraphqlSourceFields
        config={makeConfig({
          graphqlQuery:
            'query A { viewer { id } } query B { rateLimit { remaining } }',
        })}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByText(/multi-operation documents are not supported/i),
    ).toBeInTheDocument();
  });

  it('does not flag a fragment defined alongside a single operation', () => {
    render(
      <GraphqlSourceFields
        config={makeConfig({
          graphqlQuery:
            'fragment UserFields on User { id login } query GetUser { viewer { ...UserFields } }',
        })}
        onChange={() => {}}
      />,
    );

    expect(
      screen.queryByText(/multi-operation documents are not supported/i),
    ).not.toBeInTheDocument();
  });

  it('does not flag syntactically invalid queries (upstream surfaces those)', () => {
    render(
      <GraphqlSourceFields
        config={makeConfig({ graphqlQuery: 'this is not valid graphql {' })}
        onChange={() => {}}
      />,
    );

    expect(
      screen.queryByText(/multi-operation documents are not supported/i),
    ).not.toBeInTheDocument();
  });

  describe('array expression suggestion', () => {
    const orgReposQuery = `query OrgRepos {
      organization(login: "roadiehq") {
        repositories(first: 50) {
          nodes {
            name
          }
        }
      }
    }`;

    it('suggests the path to the deepest nodes selection for a Relay-style query', () => {
      render(
        <GraphqlSourceFields
          config={makeConfig({ graphqlQuery: orgReposQuery })}
          onChange={() => {}}
        />,
      );

      expect(
        screen.getByRole('button', {
          name: 'data.organization.repositories.nodes',
        }),
      ).toBeInTheDocument();
    });

    it('uses field aliases when present', () => {
      render(
        <GraphqlSourceFields
          config={makeConfig({
            graphqlQuery:
              'query { repos: repositories(first: 1) { nodes { id } } }',
          })}
          onChange={() => {}}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'data.repos.nodes' }),
      ).toBeInTheDocument();
    });

    it('does not show a suggestion when no nodes field is selected', () => {
      render(
        <GraphqlSourceFields
          config={makeConfig({
            graphqlQuery: 'query { viewer { login } }',
          })}
          onChange={() => {}}
        />,
      );

      expect(screen.queryByText(/^suggested:/i)).not.toBeInTheDocument();
    });

    it('does not show a suggestion for unparseable queries', () => {
      render(
        <GraphqlSourceFields
          config={makeConfig({ graphqlQuery: 'this is not graphql {' })}
          onChange={() => {}}
        />,
      );

      expect(screen.queryByText(/^suggested:/i)).not.toBeInTheDocument();
    });

    it('hides the suggestion when arrayExpression already matches it', () => {
      render(
        <GraphqlSourceFields
          config={makeConfig({
            graphqlQuery: orgReposQuery,
            arrayExpression: 'data.organization.repositories.nodes',
          })}
          onChange={() => {}}
        />,
      );

      expect(screen.queryByText(/^suggested:/i)).not.toBeInTheDocument();
    });

    it('applies the suggestion via onChange when clicked', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <GraphqlSourceFields
          config={makeConfig({ graphqlQuery: orgReposQuery })}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('button', {
          name: 'data.organization.repositories.nodes',
        }),
      );

      expect(onChange).toHaveBeenCalledWith(
        'arrayExpression',
        'data.organization.repositories.nodes',
      );
    });
  });
});
