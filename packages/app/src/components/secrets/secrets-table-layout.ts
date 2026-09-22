export const SECRETS_COLUMN_WIDTH = {
  name: 'w-[18%] min-w-0',
  description: 'w-[24%] min-w-0',
  status: 'w-[12%] min-w-0',
  createdAt: 'w-[14%] min-w-0',
  lastModified: 'w-[14%] min-w-0',
  helpUrl: 'w-[8%] min-w-0',
} as const;

export const SECRETS_COLUMN_WIDTHS: string[] = [
  SECRETS_COLUMN_WIDTH.name,
  SECRETS_COLUMN_WIDTH.description,
  SECRETS_COLUMN_WIDTH.status,
  SECRETS_COLUMN_WIDTH.createdAt,
  SECRETS_COLUMN_WIDTH.lastModified,
  SECRETS_COLUMN_WIDTH.helpUrl,
];
