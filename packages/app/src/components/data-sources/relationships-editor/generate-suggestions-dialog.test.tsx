import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithQuery } from '../../../test-utils';
import { GenerateSuggestionsDialog } from './generate-suggestions-dialog';
import { SuggestedRulesHeaderActions } from './suggested-rules-panel';

const DATA_SOURCES = [
  { id: 'ds-github', label: 'GitHub Repos' },
  { id: 'ds-k8s', label: 'K8s Deployments' },
  { id: 'ds-users', label: 'GitHub Users' },
];

function ControlledDialog({
  onGenerate,
  generating = false,
}: {
  onGenerate: (ids: string[]) => Promise<void>;
  generating?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <GenerateSuggestionsDialog
      open={open}
      onOpenChange={setOpen}
      dataSources={DATA_SOURCES}
      generating={generating}
      onGenerate={onGenerate}
    />
  );
}

describe('GenerateSuggestionsDialog', () => {
  it('disables Generate until at least two data sources are selected', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ControlledDialog onGenerate={vi.fn()} />);

    const generateButton = screen.getByRole('button', {
      name: /Generate \(0\)/,
    });
    expect(generateButton).toBeDisabled();

    await user.click(screen.getByText('GitHub Repos'));
    expect(
      screen.getByRole('button', { name: /Generate \(1\)/ }),
    ).toBeDisabled();

    await user.click(screen.getByText('K8s Deployments'));
    expect(
      screen.getByRole('button', { name: /Generate \(2\)/ }),
    ).toBeEnabled();
  });

  it('generates for exactly the selected data sources and closes', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(<ControlledDialog onGenerate={onGenerate} />);

    await user.click(screen.getByText('GitHub Repos'));
    await user.click(screen.getByText('GitHub Users'));
    await user.click(screen.getByRole('button', { name: /Generate \(2\)/ }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(new Set(onGenerate.mock.calls[0][0])).toEqual(
      new Set(['ds-github', 'ds-users']),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('deselecting drops a data source from the scope', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(<ControlledDialog onGenerate={onGenerate} />);

    await user.click(screen.getByText('GitHub Repos'));
    await user.click(screen.getByText('K8s Deployments'));
    await user.click(screen.getByText('GitHub Users'));
    await user.click(screen.getByText('K8s Deployments'));
    await user.click(screen.getByRole('button', { name: /Generate \(2\)/ }));

    expect(new Set(onGenerate.mock.calls[0][0])).toEqual(
      new Set(['ds-github', 'ds-users']),
    );
  });
});

describe('SuggestedRulesHeaderActions scoped generate', () => {
  const actionsState = {
    loadingIds: new Set<string>(),
    bulkLoading: false,
    approve: vi.fn(),
    dismiss: vi.fn(),
    approveSuggestion: vi.fn(),
    dismissSuggestion: vi.fn(),
    handleApproveAll: vi.fn(),
    handleDismissAll: vi.fn(),
    handleApproveManyFiltered: vi.fn(),
    handleDismissManyFiltered: vi.fn(),
  };

  it('opens the scoped-generate dialog from the Between… button', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateAll={vi.fn()}
        dataSources={DATA_SOURCES}
        onGenerateForDataSources={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Between/ }));
    expect(
      await screen.findByRole('dialog', {
        name: 'Generate between data sources',
      }),
    ).toBeInTheDocument();
  });

  it('offers no Between… button with fewer than two data sources', () => {
    renderWithQuery(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateAll={vi.fn()}
        dataSources={[DATA_SOURCES[0]]}
        onGenerateForDataSources={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Between/ }),
    ).not.toBeInTheDocument();
  });

  it('generates for the canvas selection when two or more are selected', async () => {
    const user = userEvent.setup();
    const onGenerateForDataSources = vi.fn().mockResolvedValue(undefined);
    const onGenerateAll = vi.fn();
    renderWithQuery(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateAll={onGenerateAll}
        onGenerateForDataSources={onGenerateForDataSources}
        selectedDataSourceIds={['ds-github', 'ds-k8s']}
      />,
    );

    // The canvas selection replaces the picker dialog entirely.
    expect(
      screen.queryByRole('button', { name: /Between/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Generate \(2\)/ }));
    expect(onGenerateForDataSources).toHaveBeenCalledWith([
      'ds-github',
      'ds-k8s',
    ]);
    expect(onGenerateAll).not.toHaveBeenCalled();
  });

  it('disables Generate when exactly one data source is selected', () => {
    renderWithQuery(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateAll={vi.fn()}
        onGenerateForDataSources={vi.fn()}
        selectedDataSourceIds={['ds-github']}
      />,
    );

    expect(screen.getByRole('button', { name: /Generate/ })).toBeDisabled();
  });

  it('disables Generate on the canvas surface until two data sources are selected', () => {
    // A misclick with nothing selected must never fan out a tenant-wide run.
    const { rerender } = renderWithQuery(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateForDataSources={vi.fn()}
        selectedDataSourceIds={[]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();

    rerender(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateForDataSources={vi.fn()}
        selectedDataSourceIds={['ds-github', 'ds-k8s']}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Generate \(2\)/ }),
    ).toBeEnabled();
  });

  it('omits the scoped affordance when no scoped handler is wired', () => {
    renderWithQuery(
      <SuggestedRulesHeaderActions
        suggestedRules={[]}
        generating={false}
        actionsState={actionsState}
        onGenerateAll={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Between/ }),
    ).not.toBeInTheDocument();
  });
});
