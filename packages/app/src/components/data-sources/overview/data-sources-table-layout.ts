/** Single source of truth for Data Sources column widths, consumed by the live
 * columns (`data-sources-columns.tsx`). Kept as a shared map so column
 * proportions live in one place. */

/** Percentage widths for the data-bearing columns, keyed by column id. */
export const DATA_SOURCES_COLUMN_WIDTH = {
  name: 'w-[30%] min-w-0',
  integration: 'w-[17%] min-w-0',
  setup: 'w-[9%] min-w-0',
  objects: 'w-[9%] min-w-0',
  run: 'w-[13%] min-w-0',
  created: 'w-[13%] min-w-0',
} as const;

export const DATA_SOURCES_COLUMN_WIDTHS: string[] = [
  DATA_SOURCES_COLUMN_WIDTH.name,
  DATA_SOURCES_COLUMN_WIDTH.integration,
  DATA_SOURCES_COLUMN_WIDTH.setup,
  DATA_SOURCES_COLUMN_WIDTH.objects,
  DATA_SOURCES_COLUMN_WIDTH.run,
  DATA_SOURCES_COLUMN_WIDTH.created,
];
