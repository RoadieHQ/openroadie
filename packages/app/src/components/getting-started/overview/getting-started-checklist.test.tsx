import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Blocks, Database, Share2 } from 'lucide-react';
import { GettingStartedChecklist } from './getting-started-checklist';
import type {
  OnboardingProgress,
  OnboardingStep,
} from '../use-onboarding-progress';

function makeStep(overrides: Partial<OnboardingStep>): OnboardingStep {
  return {
    id: 'integration',
    title: 'Connect an integration',
    description: 'Add a system and its secret.',
    icon: Blocks,
    done: false,
    cta: { label: 'Connect an integration', to: '/integrations' },
    ...overrides,
  };
}

function makeProgress(
  overrides?: Partial<OnboardingProgress>,
): OnboardingProgress {
  const steps = overrides?.steps ?? [
    makeStep({ id: 'integration', done: true }),
    makeStep({
      id: 'dataSource',
      title: 'Add data sources',
      icon: Share2,
      done: false,
      cta: { label: 'Go to data sources', to: '/data-sources' },
    }),
    makeStep({
      id: 'ingest',
      title: 'Ingest data',
      icon: Database,
      done: false,
      cta: { label: 'Run a data source', to: '/data-sources' },
    }),
  ];
  const completedCount = steps.filter(s => s.done).length;
  return {
    steps,
    completedCount,
    totalCount: steps.length,
    complete: completedCount === steps.length,
    loading: false,
    ...overrides,
  };
}

function renderChecklist(progress: OnboardingProgress, onDismiss = vi.fn()) {
  render(
    <MemoryRouter>
      <GettingStartedChecklist progress={progress} onDismiss={onDismiss} />
    </MemoryRouter>,
  );
  return { onDismiss };
}

describe('GettingStartedChecklist', () => {
  it('renders each step with its progress count', () => {
    renderChecklist(makeProgress());
    expect(screen.getByText('Connect an integration')).toBeInTheDocument();
    expect(screen.getByText('Add data sources')).toBeInTheDocument();
    expect(screen.getByText('Ingest data')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 complete')).toBeInTheDocument();
  });

  it('marks done steps and spotlights the first incomplete one as "Next up"', () => {
    renderChecklist(makeProgress());
    // First step is done.
    expect(screen.getByText('Done')).toBeInTheDocument();
    // The first not-done step (Add data sources) is the next up.
    expect(screen.getByText('Next up')).toBeInTheDocument();
    // Its CTA is shown; the done step's is not.
    expect(
      screen.getByRole('link', { name: /Go to data sources/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Connect an integration/ }),
    ).not.toBeInTheDocument();
  });

  it('shows an all-set state and a Dismiss action when complete', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderChecklist(
      makeProgress({
        steps: [makeStep({ done: true })],
      }),
    );
    expect(screen.getByText('All set')).toBeInTheDocument();
    expect(screen.queryByText('Next up')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('offers "Skip for now" while incomplete', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderChecklist(makeProgress());
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders skeletons instead of steps while loading', () => {
    renderChecklist(makeProgress({ loading: true }));
    expect(
      screen.queryByText('Connect an integration'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('1 of 3 complete')).not.toBeInTheDocument();
  });
});
