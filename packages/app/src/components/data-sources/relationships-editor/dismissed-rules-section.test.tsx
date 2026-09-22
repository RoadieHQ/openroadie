import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import { DismissedRulesSection } from './dismissed-rules-section';

const dismissedRule = {
  id: 'rule-1',
  name: 'repos → owners',
  sourceDatasourceId: 'ds-1',
  targetDatasourceId: 'ds-2',
  state: 'inactive',
  reviewReason: 'manual-dismiss',
  confidenceBand: 'medium',
  origin: 'generated',
};

const mockDatastore = {
  listRelationshipRules: vi.fn(),
  resetRelationshipRule: vi.fn().mockResolvedValue({}),
  deleteRelationshipRule: vi.fn().mockResolvedValue(undefined),
};
const mockAlert = { post: vi.fn() };

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastore,
  useAlert: () => mockAlert,
}));

describe('DismissedRulesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatastore.listRelationshipRules.mockResolvedValue({
      items: [dismissedRule],
      total: 1,
    });
  });

  it('requests only manually dismissed rules from the server', async () => {
    // The filter must be server-side: auto-staled inactive rules can
    // outnumber dismissals by orders of magnitude, so filtering a capped
    // page client-side would silently drop older dismissals.
    const user = userEvent.setup();
    render(<DismissedRulesSection />, { wrapper: TestQueryProvider });

    // Collapsed by default — expand to see the rows.
    await user.click(await screen.findByRole('button', { name: /Dismissed/ }));

    expect(await screen.findByText('repos → owners')).toBeInTheDocument();
    expect(mockDatastore.listRelationshipRules).toHaveBeenCalledWith({
      state: 'inactive',
      reviewReason: 'manual-dismiss',
      limit: 500,
    });
  });

  it('renders nothing when there are no dismissed rules', async () => {
    mockDatastore.listRelationshipRules.mockResolvedValue({
      items: [],
      total: 0,
    });
    const { container } = render(<DismissedRulesSection />, {
      wrapper: TestQueryProvider,
    });
    await waitFor(() =>
      expect(mockDatastore.listRelationshipRules).toHaveBeenCalled(),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reset calls the reset endpoint with the row index in the dismissed list', async () => {
    const user = userEvent.setup();
    render(<DismissedRulesSection />, { wrapper: TestQueryProvider });

    await user.click(await screen.findByRole('button', { name: /Dismissed/ }));
    await user.click(await screen.findByRole('button', { name: 'Reset' }));

    expect(mockDatastore.resetRelationshipRule).toHaveBeenCalledWith('rule-1', {
      rankShown: 0,
    });
  });

  it('delete calls the delete endpoint', async () => {
    const user = userEvent.setup();
    render(<DismissedRulesSection />, { wrapper: TestQueryProvider });

    await user.click(await screen.findByRole('button', { name: /Dismissed/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(mockDatastore.deleteRelationshipRule).toHaveBeenCalledWith('rule-1');
  });

  it('alerts on a failed reset instead of failing silently', async () => {
    mockDatastore.resetRelationshipRule.mockRejectedValueOnce(
      new Error('409 conflict'),
    );
    const user = userEvent.setup();
    render(<DismissedRulesSection />, { wrapper: TestQueryProvider });

    await user.click(await screen.findByRole('button', { name: /Dismissed/ }));
    await user.click(await screen.findByRole('button', { name: 'Reset' }));

    await waitFor(() =>
      expect(mockAlert.post).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(mockAlert.post.mock.calls[0][0].message).toContain('409 conflict');
  });

  it('alerts on a failed delete instead of failing silently', async () => {
    mockDatastore.deleteRelationshipRule.mockRejectedValueOnce(
      new Error('network error'),
    );
    const user = userEvent.setup();
    render(<DismissedRulesSection />, { wrapper: TestQueryProvider });

    await user.click(await screen.findByRole('button', { name: /Dismissed/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockAlert.post).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(mockAlert.post.mock.calls[0][0].message).toContain('network error');
  });
});
