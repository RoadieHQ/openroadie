import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  OverviewListingPageHeader,
  OverviewListingStandaloneBody,
} from '../../common';
import { PATHS } from '../../../config/paths';
import { useOnboardingProgress } from '../use-onboarding-progress';
import { useOnboardingDismissed } from '../use-onboarding-dismissed';
import { GettingStartedChecklist } from './getting-started-checklist';

export function GettingStartedPage() {
  const navigate = useNavigate();
  const progress = useOnboardingProgress();
  const { dismissed, setDismissed } = useOnboardingDismissed();

  // Retire the surface as soon as everything's done, mirroring LandingRedirect,
  // so completing the final step here also clears the sidebar entry.
  useEffect(() => {
    if (!progress.loading && progress.complete && !dismissed) {
      setDismissed(true);
    }
  }, [progress.loading, progress.complete, dismissed, setDismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    navigate(PATHS.CAPABILITIES);
  };

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <OverviewListingPageHeader
          title="Getting started"
          description="Connect a system, ingest its data, then put it to work in capabilities."
        />
        <div className="mx-auto w-full max-w-3xl">
          <GettingStartedChecklist
            progress={progress}
            onDismiss={handleDismiss}
          />
        </div>
      </OverviewListingStandaloneBody>
    </div>
  );
}
