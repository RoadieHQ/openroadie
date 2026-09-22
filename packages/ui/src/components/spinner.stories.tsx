import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './spinner';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * For inline/indeterminate waits only (busy buttons, refresh icons) — shaped
 * content gets a skeleton instead, per the loading-states conventions.
 */
export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner size={16} />
      <Spinner size={24} />
      <Spinner size={32} />
    </div>
  ),
};
