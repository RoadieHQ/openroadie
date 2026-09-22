import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextGroupRelationshipsSection } from './context-group-relationships-section';

function makeRow(index: number) {
  return {
    key: `rule-${index}`,
    relationshipType: `type${index}`,
    source: { id: `source-${index}`, name: `Source ${index}` },
    target: { id: `target-${index}`, name: `Target ${index}` },
    viewable: true,
  };
}

function renderSection(
  rows = Array.from({ length: 6 }, (_, index) => makeRow(index + 1)),
) {
  return render(
    <MemoryRouter>
      <ContextGroupRelationshipsSection rows={rows} loading={false} />
    </MemoryRouter>,
  );
}

describe('ContextGroupRelationshipsSection', () => {
  it('paginates long relationship lists', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText('Source 1')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByText('Source 6')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Source 6')).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
  });
});
