import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { MoreHorizontal, Play, Power, Trash2 } from 'lucide-react';
import { ItemListRow } from './item-list-row';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../dropdown-menu';
import type { BaseItem } from './types';

const mockItem: BaseItem = {
  id: '1',
  name: 'GitHub API',
  description:
    'Connects to GitHub REST and GraphQL APIs for repository and organization data.',
  icon: 'code',
  color: '#24292f',
  logoUrl: '',
  enabled: true,
  updatedAt: '2026-03-20T10:30:00Z',
};

const meta = {
  title: 'ItemList/ItemListRow',
  component: ItemListRow,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 700 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ItemListRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    item: mockItem,
    to: '/items/1',
  },
};

export const Disabled: Story = {
  args: {
    item: { ...mockItem, id: '2', name: 'Legacy Service', enabled: false },
    to: '/items/2',
  },
};

export const WithActions: Story = {
  args: {
    item: mockItem,
    to: '/items/1',
    onDelete: fn(),
    onRun: fn(),
    runningIds: new Set(),
  },
};

export const WithActionsDropdown: Story = {
  args: {
    item: mockItem,
    to: '/items/1',
    renderActions: item => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Actions"
            className="motion-colors inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={fn()}>
            <Play />
            <span>Run</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={fn()}>
            <Power />
            <span>{item.enabled ? 'Disable' : 'Enable'}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={fn()}>
            <Trash2 />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
};

export const WithMeta: Story = {
  args: {
    item: mockItem,
    to: '/items/1',
    onDelete: fn(),
    renderMeta: () => (
      <span className="text-xs text-muted-foreground">3 workflows</span>
    ),
  },
};
