import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from './button';

const meta = {
  title: 'Components/Button',
  component: Button,
  parameters: { layout: 'centered' },
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Save changes',
  },
};

/** All visual variants side by side — pick by intent, not by color. */
export const Variants: Story = {
  render: args => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args}>Default</Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="outline">
        Outline
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="link">
        Link
      </Button>
      <Button {...args} variant="destructive">
        Delete
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: args => (
    <div className="flex items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args}>Default</Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="icon" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <Trash2 /> Delete data source
      </>
    ),
  },
};

/**
 * `loading` disables the button and pulses the icon; `loadingText` swaps the
 * label while reserving the wider width so the button never changes size.
 */
export const Loading: Story = {
  args: {
    loading: true,
    loadingText: 'Saving…',
    children: (
      <>
        <Plus /> Save
      </>
    ),
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Unavailable',
  },
};
