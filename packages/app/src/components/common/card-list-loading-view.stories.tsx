import type { Meta, StoryObj } from '@storybook/react';
import { CardListLoadingView } from './card-list-loading-view';

/**
 * N stacked card placeholders for the card-list/grid archetype.
 * See `.claude/rules/loading-states.md`.
 */
const meta = {
  title: 'Common/CardListLoadingView',
  component: CardListLoadingView,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CardListLoadingView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    count: 3,
  },
};
