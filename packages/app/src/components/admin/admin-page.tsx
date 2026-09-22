import React, { lazy, Suspense, useMemo } from 'react';
import { Navigate, useParams } from 'react-router';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { adminSectionExtensions } from '~admin-section-extensions';
import { PATHS } from '../../config/paths';
import { useAdminSections } from '../../config/admin-sections';
import { pageContentClassName } from '../../config/page-layout';
import { useApis } from '../../api';
import type { AdminSectionHostServices } from '../../config/admin-section-extension-types';
import { SecretSettingsProvider, SecretsPage } from '../secrets';
import { AIProvidersPage } from '../ai-settings';
import { WebhooksPage } from '../webhooks';
import { McpSettingsProvider, McpServersPage } from '../mcp-settings';
import { McpAuditLogPage } from '../mcp-audit-log';
import { WorkspacesPage } from '../workspaces';
import { TeamsPage } from '../teams';

const IntegrationOverview = lazy(() =>
  import('../integrations').then(module => ({
    default: module.IntegrationOverview,
  })),
);

function SectionLoadingFallback() {
  return (
    <div className={pageContentClassName}>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

// Section content is selected by the `:tab` route param — the same routes the
// sidebar sub-items navigate to. There's no in-page tab bar: switching sections
// is the sidebar's job now, and each section page renders its own header.
function AdminSection({
  section,
  hostServices,
}: {
  section: string;
  hostServices: AdminSectionHostServices;
}) {
  // Deployment overlays register sections via the `~admin-section-extensions`
  // seam; the host renders their component with generic services injected.
  const extension = adminSectionExtensions.find(c => c.value === section);
  if (extension) {
    return <extension.Component {...hostServices} />;
  }

  switch (section) {
    case 'workspaces':
      return <WorkspacesPage />;
    case 'teams':
      return <TeamsPage />;
    case 'secrets':
      return (
        <SecretSettingsProvider>
          <SecretsPage />
        </SecretSettingsProvider>
      );
    case 'integrations':
      return (
        <Suspense fallback={<SectionLoadingFallback />}>
          <IntegrationOverview embeddedInAdmin />
        </Suspense>
      );
    case 'ai-providers':
      return <AIProvidersPage />;
    case 'webhooks':
      return <WebhooksPage />;
    case 'mcp-servers':
      return (
        <McpSettingsProvider>
          <McpServersPage />
        </McpSettingsProvider>
      );
    case 'mcp-audit-log':
      return <McpAuditLogPage />;
    default:
      return null;
  }
}

export function AdminPage() {
  const { tab } = useParams<{ tab?: string }>();
  const adminSections = useAdminSections();
  const apis = useApis();

  const validTabs = useMemo(
    () => new Set(adminSections.map(s => s.value)),
    [adminSections],
  );

  const hostServices: AdminSectionHostServices = {
    authedFetch: apis.fetch,
    backendBaseUrl: apis.config.backend.baseUrl,
    alert: apis.alert,
    config: apis.config,
  };

  const activeTab = tab ?? 'secrets';

  if (!validTabs.has(activeTab)) {
    return <Navigate to={PATHS.ADMIN_SECRETS} replace />;
  }

  return (
    <div className="flex min-h-full w-full min-w-0 flex-1 flex-col bg-background">
      <AdminSection section={activeTab} hostServices={hostServices} />
    </div>
  );
}
