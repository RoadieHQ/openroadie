import { MemoryRouter, Route, Routes } from 'react-router';
import { render, screen } from '@testing-library/react';
import { LandingRedirect } from './landing-redirect';
import type { OnboardingProgress } from './use-onboarding-progress';

const mockProgress = vi.fn();
const mockDismissed = vi.fn();

vi.mock('./use-onboarding-progress', () => ({
  useOnboardingProgress: () => mockProgress(),
}));
vi.mock('./use-onboarding-dismissed', () => ({
  useOnboardingDismissed: () => mockDismissed(),
}));

function progress(overrides?: Partial<OnboardingProgress>): OnboardingProgress {
  return {
    steps: [],
    completedCount: 0,
    totalCount: 5,
    complete: false,
    loading: false,
    ...overrides,
  };
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingRedirect />} />
        <Route path="/getting-started" element={<div>getting started</div>} />
        <Route path="/datastore" element={<div>datastore</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockDismissed.mockReturnValue({ dismissed: false, setDismissed: vi.fn() });
  mockProgress.mockReturnValue(progress());
});

describe('LandingRedirect', () => {
  it('sends an incomplete, undismissed user to getting-started', () => {
    renderAt();
    expect(screen.getByText('getting started')).toBeInTheDocument();
  });

  it('sends a completed user to the datastore', () => {
    mockProgress.mockReturnValue(progress({ complete: true }));
    renderAt();
    expect(screen.getByText('datastore')).toBeInTheDocument();
  });

  it('sends a dismissed user straight to the datastore without waiting on progress', () => {
    mockDismissed.mockReturnValue({ dismissed: true, setDismissed: vi.fn() });
    mockProgress.mockReturnValue(progress({ loading: true }));
    renderAt();
    expect(screen.getByText('datastore')).toBeInTheDocument();
  });

  it('holds (renders nothing) while progress is still loading', () => {
    mockProgress.mockReturnValue(progress({ loading: true }));
    renderAt();
    expect(screen.queryByText('getting started')).not.toBeInTheDocument();
    expect(screen.queryByText('datastore')).not.toBeInTheDocument();
  });
});
