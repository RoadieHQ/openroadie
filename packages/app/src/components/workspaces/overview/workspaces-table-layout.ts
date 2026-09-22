export const WORKSPACES_COLUMN_WIDTH = {
  name: 'w-[28%] min-w-0',
  slug: 'w-[18%] min-w-0',
  type: 'w-[14%] min-w-0',
  owner: 'w-[22%] min-w-0',
  createdAt: 'w-[18%] min-w-0',
} as const;

export const WORKSPACES_COLUMN_WIDTHS: string[] = [
  WORKSPACES_COLUMN_WIDTH.name,
  WORKSPACES_COLUMN_WIDTH.slug,
  WORKSPACES_COLUMN_WIDTH.type,
  WORKSPACES_COLUMN_WIDTH.owner,
  WORKSPACES_COLUMN_WIDTH.createdAt,
];
