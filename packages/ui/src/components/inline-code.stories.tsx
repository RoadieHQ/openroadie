import type { Meta, StoryObj } from '@storybook/react';
import { InlineCode } from './inline-code';

const meta = {
  title: 'Components/InlineCode',
  component: InlineCode,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof InlineCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'npm install',
  },
};

export const InParagraph: Story = {
  render: () => (
    <p style={{ fontSize: 14 }}>
      Run <InlineCode>yarn dev</InlineCode> to start the development server.
    </p>
  ),
};
