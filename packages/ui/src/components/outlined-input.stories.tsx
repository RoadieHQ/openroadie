import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { OutlinedInput } from './outlined-input';

const meta = {
  title: 'Form/OutlinedInput',
  component: OutlinedInput,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 400, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OutlinedInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    label: 'Name *',
    onChange: fn(),
  },
};

export const Filled: Story = {
  args: {
    label: 'Name *',
    value: 'GitHub API',
    onChange: fn(),
  },
};

export const Required: Story = {
  args: {
    label: 'URL *',
    required: true,
    value: 'https://api.github.com',
    onChange: fn(),
  },
};

export const Disabled: Story = {
  args: {
    label: 'Slug',
    value: 'github-api',
    disabled: true,
    onChange: fn(),
  },
};

export const WithStartAdornment: Story = {
  args: {
    label: 'Name *',
    className: 'pl-[46px] pr-[14px]',
    labelClassName: 'peer-placeholder-shown:left-[46px] peer-focus:left-[10px]',
    value: 'GitHub API',
    onChange: fn(),
    startAdornment: (
      <div className="absolute top-1/2 left-[14px] -translate-y-1/2">
        <span className="text-muted-foreground">🔗</span>
      </div>
    ),
  },
};
