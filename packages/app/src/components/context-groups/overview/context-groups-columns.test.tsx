import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import type { ContextGroupRule } from '../types';
import { useContextGroupColumns } from './context-groups-columns';

function makeRule(overrides?: Partial<ContextGroupRule>): ContextGroupRule {
  return {
    id: 'cg-1',
    name: 'Incident Response',
    slug: 'incident-response',
    description: null,
    datasources: [],
    mergeRelationshipTypes: [],
    annotations: [],
    includeExternalRelations: true,
    seedVersion: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

function ColumnsHarness({ rule }: { rule: ContextGroupRule }) {
  const columns = useContextGroupColumns();
  const nameColumn = columns.find(column => column.id === 'name');
  const dataSourcesColumn = columns.find(column => column.id === 'dataSources');
  const completenessColumn = columns.find(
    column => column.id === 'completeness',
  );

  if (!nameColumn || !dataSourcesColumn || !completenessColumn) {
    throw new Error('Expected name, data sources, and completeness columns');
  }

  return (
    <>
      <div data-testid="name-cell">{nameColumn.cell(rule)}</div>
      <div data-testid="data-sources-cell">{dataSourcesColumn.cell(rule)}</div>
      <div data-testid="completeness-cell">{completenessColumn.cell(rule)}</div>
    </>
  );
}

describe('useContextGroupColumns', () => {
  it('shows the available datasource count in the data sources column', () => {
    render(
      <MemoryRouter>
        <ColumnsHarness
          rule={makeRule({
            datasources: [
              { datasourceId: 'ds-1', status: { live: true } },
              { datasourceId: 'ds-2', status: { live: false } },
              { datasourceId: 'ds-3', status: { live: true } },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('data-sources-cell')).toHaveTextContent(
      '2 available',
    );
    expect(screen.getByTestId('name-cell')).not.toHaveTextContent('Incomplete');
    expect(screen.getByTestId('data-sources-cell')).not.toHaveTextContent(
      'Incomplete',
    );
    expect(screen.getByTestId('completeness-cell')).not.toHaveTextContent(
      'Incomplete',
    );
  });

  it('shows incomplete only in the completeness cell when no datasource is available', () => {
    render(
      <MemoryRouter>
        <ColumnsHarness
          rule={makeRule({
            datasources: [
              { datasourceId: 'ds-1', status: { live: false } },
              { datasourceId: 'ds-2', status: { live: false } },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('data-sources-cell')).toHaveTextContent(
      '0 available',
    );
    expect(screen.getByTestId('completeness-cell')).toHaveTextContent(
      'Incomplete',
    );
    expect(screen.getByTestId('data-sources-cell')).not.toHaveTextContent(
      'Incomplete',
    );
    expect(screen.getByTestId('name-cell')).not.toHaveTextContent('Incomplete');
  });
});
