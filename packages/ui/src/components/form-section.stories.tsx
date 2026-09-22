import type { Meta, StoryObj } from '@storybook/react';
import { FormSection } from './form-section';

const meta = {
  title: 'Form/FormSection',
  component: FormSection,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 500, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Connection',
  },
};

export const Authentication: Story = {
  args: {
    title: 'Authentication',
  },
};
