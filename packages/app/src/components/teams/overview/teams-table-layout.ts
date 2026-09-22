export const TEAMS_COLUMN_WIDTH = {
  name: 'w-[34%] min-w-0',
  slug: 'w-[28%] min-w-0',
  members: 'w-[18%] min-w-0',
  createdAt: 'w-[20%] min-w-0',
} as const;

export const TEAMS_COLUMN_WIDTHS: string[] = [
  TEAMS_COLUMN_WIDTH.name,
  TEAMS_COLUMN_WIDTH.slug,
  TEAMS_COLUMN_WIDTH.members,
  TEAMS_COLUMN_WIDTH.createdAt,
];
