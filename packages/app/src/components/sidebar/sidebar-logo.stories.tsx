import type { Meta, StoryObj } from '@storybook/react';
import { SidebarLogo } from './sidebar-logo';

const meta = {
  title: 'Sidebar/SidebarLogo',
  component: SidebarLogo,
  argTypes: {
    collapsed: { control: 'boolean' },
  },
} satisfies Meta<typeof SidebarLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  args: { collapsed: false },
};

export const Collapsed: Story = {
  args: { collapsed: true },
};
