import type { ComponentType } from 'react';
import type { AlertApi, AppConfig } from '../api/infrastructure';

// Services the host hands to an extension's page component. Kept generic
// (an authed `fetch` + the backend base URL) so any deployment-specific admin
// section can build its own clients without importing from `packages/app`.
export interface AdminSectionHostServices {
  authedFetch: typeof fetch;
  backendBaseUrl: string;
  alert: AlertApi;
  config: AppConfig;
}

// A deployment-specific admin section registered through the
// `~admin-section-extensions` seam. Structurally re-declared in the overlay,
// which cannot import across the package boundary.
export interface AdminSectionContribution {
  value: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType<AdminSectionHostServices>;
}
