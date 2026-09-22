import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ArrowLeft, Blocks, Database, Waypoints } from 'lucide-react';
import { SidebarNavItem } from './sidebar-nav-item';

const meta = {
  title: 'Sidebar/SidebarNavItem',
  component: SidebarNavItem,
  argTypes: {
    icon: { control: false },
    label: { control: 'text' },
    active: { control: 'boolean' },
    collapsed: { control: 'boolean' },
    to: { control: 'text' },
    href: { control: 'text' },
  },
  decorators: [
    Story => (
      <div style={{ width: 207 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SidebarNavItem>;

export default meta;

// Against the component, not `typeof meta`: the props are a three-way union
// (`to` XOR `href` XOR `onClick`), and deriving the args type from meta
// intersects those branches into `never` so no story could satisfy it.
type Story = StoryObj<typeof SidebarNavItem>;

export const Default: Story = {
  args: {
    icon: Database,
    label: 'Data Sources',
    active: false,
    collapsed: false,
    to: '/data-sources',
  },
};

export const Active: Story = {
  args: {
    icon: Waypoints,
    label: 'Relationships',
    active: true,
    collapsed: false,
    to: '/relationships',
  },
};

export const Collapsed: Story = {
  args: {
    icon: Blocks,
    label: 'Integrations',
    active: false,
    collapsed: true,
    to: '/integrations',
  },
  decorators: [
    Story => (
      <div style={{ width: 72 }}>
        <Story />
      </div>
    ),
  ],
};

export const CollapsedActive: Story = {
  args: {
    icon: Waypoints,
    label: 'Relationships',
    active: true,
    collapsed: true,
    to: '/relationships',
  },
  decorators: [
    Story => (
      <div style={{ width: 72 }}>
        <Story />
      </div>
    ),
  ],
};

export const AsLink: Story = {
  args: {
    icon: ArrowLeft,
    label: 'Back to App',
    active: false,
    collapsed: false,
    href: 'https://example.com',
  },
};
