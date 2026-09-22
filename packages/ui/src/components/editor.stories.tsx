import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Editor } from './editor';

const meta = {
  title: 'Form/Editor',
  component: Editor,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div className="w-[480px] p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    'aria-label': 'Code',
    value: '{\n  "name": "Roadie"\n}',
    onChange: fn(),
    height: '180px',
  },
};

export const WithError: Story = {
  args: {
    'aria-label': 'Code',
    value: '{\n  "name": \n}',
    onChange: fn(),
    error: 'Invalid JSON',
    height: '180px',
  },
};

export const ReadOnly: Story = {
  args: {
    'aria-label': 'Code',
    value:
      '# Capability instructions\n\nUse @datasource:github to load repositories.',
    onChange: fn(),
    readOnly: true,
    height: '180px',
  },
};
