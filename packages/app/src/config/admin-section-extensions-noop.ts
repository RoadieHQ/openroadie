import type { AdminSectionContribution } from './admin-section-extension-types';

// OSS fallback for the `~admin-section-extensions` seam (see vite.config.ts).
// OSS registers no extra admin sections; a deployment overlay replaces this
// alias with its own list of contributions.
export const adminSectionExtensions: AdminSectionContribution[] = [];
