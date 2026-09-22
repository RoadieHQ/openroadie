import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocalStorage } from 'react-use';

export const ONBOARDING_DISMISSED_STORAGE_KEY =
  'roadie.getting-started.dismissed';

export function readOnboardingDismissed(): boolean {
  try {
    const stored = window.localStorage.getItem(
      ONBOARDING_DISMISSED_STORAGE_KEY,
    );
    if (stored == null) {
      return false;
    }
    return JSON.parse(stored) === true;
  } catch {
    return false;
  }
}

interface OnboardingDismissedValue {
  dismissed: boolean;
  setDismissed: (value: boolean) => void;
}

const OnboardingDismissedContext =
  createContext<OnboardingDismissedValue | null>(null);

/**
 * Holds the "getting-started dismissed" flag as shared state so the sidebar and
 * the getting-started surface react to each other in the same tab — separate
 * `useLocalStorage` instances don't sync, so dismissing on the page would
 * otherwise leave the sidebar entry until reload. This is browser-local UI
 * state, the only thing we persist about onboarding (every step's done/undone
 * is computed live; see {@link useOnboardingProgress}). Kept out of React Query
 * per `data-loading.md`.
 */
export function OnboardingDismissedProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [stored, setStored] = useLocalStorage<boolean>(
    ONBOARDING_DISMISSED_STORAGE_KEY,
    false,
  );
  const value = useMemo<OnboardingDismissedValue>(
    () => ({
      dismissed: stored ?? false,
      setDismissed: next => setStored(next),
    }),
    [stored, setStored],
  );
  return (
    <OnboardingDismissedContext.Provider value={value}>
      {children}
    </OnboardingDismissedContext.Provider>
  );
}

export function useOnboardingDismissed(): OnboardingDismissedValue {
  const ctx = useContext(OnboardingDismissedContext);
  if (!ctx) {
    throw new Error(
      'useOnboardingDismissed must be used within an OnboardingDismissedProvider',
    );
  }
  return ctx;
}
