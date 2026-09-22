import { redirect } from 'react-router';
import { PATHS } from '../../config/paths';
import { readOnboardingDismissed } from './use-onboarding-dismissed';

export function landingLoader() {
  if (readOnboardingDismissed()) {
    return redirect(PATHS.DATASTORE);
  }
  return null;
}
