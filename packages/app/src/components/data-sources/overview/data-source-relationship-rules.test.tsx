import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DataSourceRelationshipRules } from './data-source-relationship-rules';
import type { DataSourceRelationshipRule } from './use-data-source-detail';

const rules: DataSourceRelationshipRule[] = [
  {
    id: 'rule-1',
    name: 'owner → team',
    relationshipType: 'ownedBy',
    direction: 'outbound',
    relatedDatasourceId: 'ds-2',
    count: 12,
  },
  {
    id: 'direct-ds-2-outbound-dependsOn',
    name: 'Direct relationships',
    relationshipType: 'dependsOn',
    direction: 'outbound',
    relatedDatasourceId: 'ds-2',
    count: 3,
    direct: true,
  },
];

function makeRule(index: number): DataSourceRelationshipRule {
  return {
    id: `rule-${index}`,
    name: `rule ${index}`,
    relationshipType: `type${index}`,
    direction: 'outbound',
    relatedDatasourceId: `ds-${index}`,
    count: index,
  };
}

function renderRules(
  overrides: Partial<
    React.ComponentProps<typeof DataSourceRelationshipRules>
  > = {},
) {
  render(
    <MemoryRouter>
      <DataSourceRelationshipRules
        rules={rules}
        currentDataSourceId="ds-1"
        nameById={new Map([['ds-2', 'GitHub Users']])}
        enabledDataSourceIds={new Set(['ds-1', 'ds-2'])}
        loading={false}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DataSourceRelationshipRules', () => {
  it('marks direct aggregate rows with the Direct relationship badge', () => {
    renderRules();
    expect(screen.getByText('Direct relationship')).toBeInTheDocument();
    expect(screen.getByText('Depends on')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks rule rows with the Relationship rule badge', () => {
    renderRules();
    expect(screen.getAllByText('Direct relationship')).toHaveLength(1);
    expect(screen.getAllByText('Relationship rule').length).toBeGreaterThan(0);
    expect(screen.getByText('Owned by')).toBeInTheDocument();
  });

  it('paginates long relationship lists', async () => {
    const user = userEvent.setup();
    const longRules = Array.from({ length: 6 }, (_, index) =>
      makeRule(index + 1),
    );
    const nameById = new Map(
      longRules.map(rule => [rule.relatedDatasourceId, `Source ${rule.count}`]),
    );

    renderRules({
      rules: longRules,
      nameById,
      enabledDataSourceIds: new Set([
        'ds-1',
        ...longRules.map(rule => rule.relatedDatasourceId),
      ]),
    });

    expect(screen.getByText('Source 1')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByText('Source 6')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Source 6')).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
  });
});
