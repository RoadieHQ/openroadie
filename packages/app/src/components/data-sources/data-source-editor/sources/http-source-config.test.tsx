import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../../test-utils';
import { Textarea } from '@roadiehq/ui/textarea';
import { HttpSourceConfig } from './http-source-config';
import type { HttpIntegrationSourceConfig } from '../data-source-editor-context';
import type { Integration } from '../../../integrations/types';

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
vi.mock('./graphql-source-fields', () => ({
  GraphqlSourceFields: () => <div data-testid="graphql-fields" />,
}));

const listPathSuggestions = vi.fn(() => Promise.resolve([]));
const getSchema = vi.fn(() => Promise.resolve(null));

vi.mock('../data-source-editor-context', async () => {
  const actual = await vi.importActual('../data-source-editor-context');
  return {
    ...actual,
    useDataSourceEditorContext: () => ({
      workflowApi: {
        integrationSchemas: { listPathSuggestions, getSchema },
        integrations: { update: vi.fn() },
      },
    }),
  };
});

vi.mock('../../../../api', () => ({
  useAlert: () => ({ post: vi.fn() }),
  useSecrets: () => ({ getKeys: () => Promise.resolve([]) }),
}));

const integration = {
  id: 'int-1',
  slug: 'github',
  name: 'GitHub',
  backendType: 'http',
} as Integration;

function renderConfig(config: HttpIntegrationSourceConfig = {}) {
  const onChange = vi.fn();
  render(
    <HttpSourceConfig
      config={config}
      onChange={onChange}
      integration={integration}
    />,
    { wrapper: TestQueryProvider },
  );
  return onChange;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HttpSourceConfig method select', () => {
  it('defaults to GET', () => {
    renderConfig();
    expect(
      screen.getByRole('combobox', { name: /http method/i }),
    ).toHaveTextContent('GET');
  });

  it('fires onChange when POST is selected', async () => {
    const user = userEvent.setup();
    const onChange = renderConfig();

    await user.click(screen.getByRole('combobox', { name: /http method/i }));
    await user.click(screen.getByRole('option', { name: 'POST' }));

    expect(onChange).toHaveBeenCalledWith('method', 'POST');
  });

  it('requests path suggestions for the selected method', async () => {
    renderConfig({ method: 'POST' });
    await waitFor(() => {
      expect(listPathSuggestions).toHaveBeenCalledWith('int-1', 'POST');
    });
  });
});

describe('HttpSourceConfig request body', () => {
  it('hides the body editor for GET', () => {
    renderConfig();
    expect(screen.queryByTestId('http-source-body')).not.toBeInTheDocument();
  });

  it('shows the body editor for POST', () => {
    renderConfig({ method: 'POST' });
    expect(screen.getByTestId('http-source-body')).toBeInTheDocument();
  });

  it('propagates body edits as bodyText', async () => {
    const user = userEvent.setup();
    const onChange = renderConfig({ method: 'POST' });
    await user.type(screen.getByTestId('http-source-body'), 'x');
    expect(onChange).toHaveBeenCalledWith('bodyText', 'x');
  });

  it('hydrates the editor from a saved body when bodyText is untouched', () => {
    renderConfig({ method: 'POST', body: { query: 'status:active' } });
    expect(screen.getByTestId('http-source-body')).toHaveValue(
      JSON.stringify({ query: 'status:active' }, null, 2),
    );
  });

  it('prefers bodyText over the saved body once the user has typed', () => {
    renderConfig({ method: 'POST', body: { a: 1 }, bodyText: '{"b": 2}' });
    expect(screen.getByTestId('http-source-body')).toHaveValue('{"b": 2}');
  });

  it('shows an inline error for malformed body JSON', () => {
    renderConfig({ method: 'POST', bodyText: '{oops' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /request body json is invalid/i,
    );
  });

  it('shows no error for an empty body', () => {
    renderConfig({ method: 'POST', bodyText: '' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
