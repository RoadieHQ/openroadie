import { OVERVIEW_ALL_GROUP } from '../../overview';

/** Single source of truth for Integrations column widths, consumed by the live
 * columns (`integrations-columns.tsx`). Kept as a shared map so column
 * proportions live in one place. */

/** Percentage widths for the data-bearing columns, keyed by column id. */
export const INTEGRATIONS_COLUMN_WIDTH = {
  name: 'w-[24%] min-w-0',
  category: 'w-[14%] min-w-0',
  host: 'w-[18%] min-w-0',
  setup: 'w-[14%] min-w-0',
  source: 'w-[12%] min-w-0',
  updated: 'w-[10%] min-w-0',
} as const;

export const INTEGRATIONS_COLUMN_WIDTHS: string[] = [
  INTEGRATIONS_COLUMN_WIDTH.name,
  INTEGRATIONS_COLUMN_WIDTH.category,
  INTEGRATIONS_COLUMN_WIDTH.host,
  INTEGRATIONS_COLUMN_WIDTH.setup,
  INTEGRATIONS_COLUMN_WIDTH.source,
  INTEGRATIONS_COLUMN_WIDTH.updated,
];

/** Column widths for the loading skeleton and route fallback. Mirrors
 * `useIntegrationColumns`: the Category column is only shown in the All view. */
export function getIntegrationsColumnWidths(
  activeGroup: string = OVERVIEW_ALL_GROUP,
): string[] {
  const widths: string[] = [INTEGRATIONS_COLUMN_WIDTH.name];
  if (activeGroup === OVERVIEW_ALL_GROUP) {
    widths.push(INTEGRATIONS_COLUMN_WIDTH.category);
  }
  widths.push(
    INTEGRATIONS_COLUMN_WIDTH.host,
    INTEGRATIONS_COLUMN_WIDTH.setup,
    INTEGRATIONS_COLUMN_WIDTH.source,
    INTEGRATIONS_COLUMN_WIDTH.updated,
  );
  return widths;
}

/** Left gutter on the Name column (matches the live column's headClassName). */
export const INTEGRATIONS_NAME_GUTTER = 'pl-4 sm:pl-5';
