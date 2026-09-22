import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../test-utils';
import { ContextGroupInstancesSection } from './context-group-instances-section';

const mockDatastore = {
  getContextGroupRuleGroups: vi.fn(),
};

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastore,
}));

function makeGroup(
  index: number,
  options: { includePresentation?: boolean } = {},
) {
  const { includePresentation = true } = options;
  return {
    id: `group-${index}`,
    name: `Repositories: repo-${index}`,
    members: [
      {
        datasourceId: 'ds-repos',
        objectId: `repo-${index}`,
        object: { name: `repo-${index}` },
        presentation: includePresentation
          ? { title: `repo-${index}` }
          : undefined,
      },
      ...(index % 2 === 0
        ? [
            {
              datasourceId: 'ds-teams',
              objectId: `team-${index}`,
              object: {},
              presentation: { title: `team-${index}` },
            },
          ]
        : []),
    ],
  };
}

function renderSection() {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <ContextGroupInstancesSection ruleId="rule-1" />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('ContextGroupInstancesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error message instead of the empty state when the fetch fails', async () => {
    mockDatastore.getContextGroupRuleGroups.mockRejectedValue(
      new Error('boom'),
    );

    renderSection();

    expect(await screen.findByText('Failed to load groups.')).toBeVisible();
    expect(
      screen.queryByText('No groups available yet.'),
    ).not.toBeInTheDocument();
  });

  it('renders available groups with presentation-title links', async () => {
    mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
      totalGroups: 2,
      groups: [makeGroup(1, { includePresentation: false }), makeGroup(2)],
    });

    renderSection();

    expect(await screen.findByText('repo-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^repo-1$/ })).toHaveAttribute(
      'href',
      '/context-groups/groups/group-1',
    );
  });

  it('falls back to the backend group name when no display title is present', async () => {
    mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
      totalGroups: 1,
      groups: [
        {
          id: 'group-1',
          name: 'Platform Team',
          members: [
            {
              datasourceId: 'ds-repos',
              objectId: '2201967',
              object: {},
            },
          ],
        },
      ],
    });

    renderSection();

    expect(await screen.findByText('Platform Team')).toBeInTheDocument();
    expect(screen.queryByText('2201967')).not.toBeInTheDocument();
  });

  it('paginates long instance lists', async () => {
    const user = userEvent.setup();
    mockDatastore.getContextGroupRuleGroups.mockImplementation(
      async (
        _ruleId: string,
        options?: { limit?: number; offset?: number },
      ) => {
        const offset = options?.offset ?? 0;
        if (offset === 0) {
          return {
            totalGroups: 11,
            groups: Array.from({ length: 10 }, (_, index) =>
              makeGroup(index + 1),
            ),
          };
        }

        return {
          totalGroups: 11,
          groups: [makeGroup(11)],
        };
      },
    );

    renderSection();

    expect(await screen.findByText('repo-1')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByText('repo-11')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('repo-11')).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
  });
});
