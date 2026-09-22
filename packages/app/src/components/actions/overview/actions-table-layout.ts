export const ACTIONS_COLUMN_WIDTH = {
  name: 'w-[46%] min-w-0',
  steps: 'w-[16%] min-w-0',
  status: 'w-[14%] min-w-0',
  updated: 'w-[16%] min-w-0',
} as const;

export const ACTIONS_COLUMN_WIDTHS: string[] = [
  ACTIONS_COLUMN_WIDTH.name,
  ACTIONS_COLUMN_WIDTH.steps,
  ACTIONS_COLUMN_WIDTH.status,
  ACTIONS_COLUMN_WIDTH.updated,
];
