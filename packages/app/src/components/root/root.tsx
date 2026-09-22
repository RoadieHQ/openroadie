import React from 'react';
import { Sidebar } from '../sidebar';
import { AISettingsProvider } from '../ai-settings';
import { OverviewDataProvider } from '../overview';
import { useBottomNavItems, useNavItems } from '../../config/navigation';
import { useAppConfig } from '../../api';
import { PATHS } from '../../config/paths';
import { useOnboardingDismissed } from '../getting-started/use-onboarding-dismissed';

type RootProps = {
  children: React.ReactNode;
  pendingPath?: string;
  pendingSearch?: string;
  routeName?: string;
};

export function Root({
  children,
  pendingPath,
  pendingSearch,
  routeName,
}: RootProps) {
  const config = useAppConfig();
  const roadieUrl = config.app.roadieUrl;
  const { dismissed: onboardingDismissed } = useOnboardingDismissed();
  // Getting started is a first-run affordance, not a permanent fixture: once
  // the user finishes onboarding (auto-dismissed) or skips it, drop it from the
  // sidebar so it doesn't nag returning users.
  const navItems = useNavItems().filter(
    item => item.path !== PATHS.GETTING_STARTED || !onboardingDismissed,
  );
  const bottomNavItems = useBottomNavItems();

  return (
    <AISettingsProvider>
      <OverviewDataProvider>
        <div className="flex h-screen w-full min-w-0 overflow-hidden bg-background">
          <Sidebar
            navItems={navItems}
            bottomNavItems={bottomNavItems}
            roadieUrl={roadieUrl}
            pendingPath={pendingPath}
            pendingSearch={pendingSearch}
          />
          <main
            data-route={routeName}
            className="app-route-content relative z-0 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth"
          >
            {children}
          </main>
        </div>
      </OverviewDataProvider>
    </AISettingsProvider>
  );
}
