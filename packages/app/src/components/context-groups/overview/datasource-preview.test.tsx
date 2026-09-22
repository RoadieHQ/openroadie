import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { DatasourceFilter } from '../types';
import { DatasourcePreview } from './datasource-preview';

function hasTextContent(text: RegExp) {
  return (_content: string, element: Element | null) =>
    text.test(element?.textContent ?? '');
}

function makeFilter(
  label: string,
  live: boolean,
  datasourceId = label.toLowerCase().replace(/\s+/g, '-'),
): DatasourceFilter {
  return {
    datasourceId,
    status: {
      live,
      datasourceId,
      displayName: label,
      inactiveReason: live ? undefined : 'Inactive for test',
    },
  };
}

describe('DatasourcePreview', () => {
  it('sorts live datasources first and paginates long lists', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <DatasourcePreview
          title="Root datasources"
          filters={[
            makeFilter('Delta source', false),
            makeFilter('Bravo source', true),
            makeFilter('Foxtrot source', false),
            makeFilter('Alpha source', false),
            makeFilter('Echo source', true),
            makeFilter('Charlie source', false),
          ]}
        />
      </MemoryRouter>,
    );

    const table = screen.getByRole('table');
    const firstPageRows = within(table).getAllByRole('row');

    expect(firstPageRows).toHaveLength(6);
    expect(firstPageRows[1]).toHaveTextContent('Bravo source');
    expect(firstPageRows[2]).toHaveTextContent('Echo source');
    expect(firstPageRows[3]).toHaveTextContent('Alpha source');
    expect(firstPageRows[4]).toHaveTextContent('Charlie source');
    expect(firstPageRows[5]).toHaveTextContent('Delta source');
    expect(screen.queryByText('Foxtrot source')).not.toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(
      screen.getByText(hasTextContent(/Showing 1.?5 of 6/), { selector: 'p' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(screen.getByText('Foxtrot source')).toBeInTheDocument();
    expect(screen.queryByText('Bravo source')).not.toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    expect(
      screen.getByText(hasTextContent(/Showing 6.?6 of 6/), { selector: 'p' }),
    ).toBeInTheDocument();
  });
});
