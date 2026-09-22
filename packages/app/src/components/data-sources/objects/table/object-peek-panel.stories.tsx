import type { Meta, StoryObj } from '@storybook/react';
import { ObjectPeekPanel } from './object-peek-panel';

const meta = {
  title: 'DataSources/ObjectPeekPanel',
  component: ObjectPeekPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // Rendered inside an expanded row, so it inherits that row's tinted cell.
    Story => (
      <div className="bg-muted/30 p-0">
        <Story />
      </div>
    ),
  ],
  args: {
    object: {
      id: 42,
      full_name: 'RoadieHQ/openroadie',
      private: true,
      owner: { login: 'RoadieHQ', type: 'Organization' },
      topics: ['developer-portal', 'catalog'],
      language: 'TypeScript',
    },
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-28T09:30:00Z',
  },
} satisfies Meta<typeof ObjectPeekPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Search hits carry no timestamps, so the footer is omitted entirely. */
export const WithoutTimestamps: Story = {
  args: { createdAt: '', updatedAt: '' },
};
