export const CONTEXT_GROUPS_COLUMN_WIDTH = {
  name: 'w-[40%] min-w-0',
  dataSources: 'w-[20%] min-w-0',
  completeness: 'w-[20%] min-w-0',
  updated: 'w-[20%] min-w-0',
} as const;

export const CONTEXT_GROUPS_COLUMN_WIDTHS: string[] = [
  CONTEXT_GROUPS_COLUMN_WIDTH.name,
  CONTEXT_GROUPS_COLUMN_WIDTH.dataSources,
  CONTEXT_GROUPS_COLUMN_WIDTH.completeness,
  CONTEXT_GROUPS_COLUMN_WIDTH.updated,
];
