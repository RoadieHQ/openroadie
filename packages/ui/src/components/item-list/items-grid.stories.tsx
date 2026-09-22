import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Database } from 'lucide-react';
import { ItemsGrid } from './items-grid';
import { ItemListRow } from './item-list-row';
import type { BaseItem, ItemGroup } from './types';

const makeItem = (id: string, name: string, enabled = true): BaseItem => ({
  id,
  name,
  description: `Description for ${name}`,
  logoUrl: '',
  enabled,
  updatedAt: '2026-03-20T10:30:00Z',
});

const items: BaseItem[] = [
  makeItem('1', 'GitHub API'),
  makeItem('2', 'PagerDuty'),
  makeItem('3', 'Datadog', false),
  makeItem('4', 'Jenkins CI'),
  makeItem('5', 'AWS CloudWatch'),
  makeItem('6', 'Snyk'),
];

const groups: ItemGroup<BaseItem>[] = [
  {
    key: 'scm',
    label: 'Source Control',
    logoUrl: '',
    items: [items[0]],
  },
  {
    key: 'monitoring',
    label: 'Monitoring',
    logoUrl: '',
    items: [items[1], items[2], items[4]],
  },
  {
    key: 'ci-cd',
    label: 'CI / CD',
    logoUrl: '',
    items: [items[3], items[5]],
  },
];

const renderListRow = (item: BaseItem) => (
  <ItemListRow item={item} to={`/items/${item.id}`} />
);

const meta = {
  title: 'ItemList/ItemsGrid',
  component: ItemsGrid,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <div style={{ padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ItemsGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListView: Story = {
  args: {
    items,
    onCreate: fn(),
    emptyIcon: <Database className="size-10 text-muted-foreground" />,
    emptyTitle: 'No items',
    emptyDescription: 'Create your first item.',
    createButtonLabel: 'Create Item',
    renderListRow,
  },
};

export const GroupedList: Story = {
  args: {
    ...ListView.args,
    groups,
  },
};

export const Empty: Story = {
  args: {
    ...ListView.args,
    items: [],
  },
};
