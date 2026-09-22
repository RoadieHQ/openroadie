import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { PATHS } from '../../config/paths';
import { useOnboardingProgress } from './use-onboarding-progress';
import { useOnboardingDismissed } from './use-onboarding-dismissed';

/**
 * The `/` landing decision. While onboarding is incomplete AND not dismissed, a
 * brand-new user is sent to `/getting-started`; everyone else falls through to
 * the app's default route. Dismissed users skip straight through without
 * waiting on the progress queries, so returning users never see a stall.
 */
export function LandingRedirect() {
  const { dismissed, setDismissed } = useOnboardingDismissed();
  const { complete, loading } = useOnboardingProgress();

  // Onboarding is done — retire the getting-started surface (drops the sidebar
  // entry) so a returning user isn't nagged. Persisting it also means a later
  // dip below "complete" (e.g. deleting a capability) won't resurrect it.
  useEffect(() => {
    if (!loading && complete && !dismissed) {
      setDismissed(true);
    }
  }, [loading, complete, dismissed, setDismissed]);

  if (dismissed) {
    return <Navigate to={PATHS.DATASTORE} replace />;
  }
  // Hold the redirect until progress settles so we don't route to the default
  // page and then bounce to getting-started (or vice versa). The app shell /
  // sidebar stay rendered around this, so it isn't a blank screen.
  if (loading) {
    return null;
  }
  return (
    <Navigate to={complete ? PATHS.DATASTORE : PATHS.GETTING_STARTED} replace />
  );
}
