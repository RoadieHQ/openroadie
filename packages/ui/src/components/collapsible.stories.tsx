import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from './collapsible';

const meta = {
  title: 'Components/Collapsible',
  component: Collapsible,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 320, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onOpenChange: fn(),
  },
  render: args => (
    <Collapsible {...args}>
      <CollapsibleTrigger>Toggle</CollapsibleTrigger>
      <CollapsibleContent>
        <p>Collapsible content goes here.</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const DefaultOpen: Story = {
  args: {
    defaultOpen: true,
    onOpenChange: fn(),
  },
  render: args => (
    <Collapsible {...args}>
      <CollapsibleTrigger>Toggle</CollapsibleTrigger>
      <CollapsibleContent>
        <p>This content is visible by default.</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Controlled: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
  },
  render: args => (
    <Collapsible {...args}>
      <CollapsibleTrigger>Toggle</CollapsibleTrigger>
      <CollapsibleContent>
        <p>Controlled open state.</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};
