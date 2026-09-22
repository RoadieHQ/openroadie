import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './reasoning';

const reasoningText = `I need to find which team owns payment-service.

1. The workload's image tag is \`sha-4f21c\`, so I can match it to a commit in the github-repositories data source.
2. That commit belongs to roadie/payment-service, whose CODEOWNERS points at the Payments Platform team.

I should also check the tenant database mapping to confirm blast radius before answering.`;

/**
 * Collapsible "thinking" section for model reasoning. It auto-opens while
 * streaming and summarizes duration once done — use it so users can inspect
 * why the assistant answered the way it did without reading it by default.
 */
const meta = {
  title: 'AiElements/Reasoning',
  component: Reasoning,
  parameters: { layout: 'centered' },
  args: {
    onOpenChange: fn(),
  },
  decorators: [
    Story => (
      <div style={{ width: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Reasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Finished reasoning, expanded — the trigger reports how long it took. */
export const Default: Story = {
  args: {
    defaultOpen: true,
    duration: 12,
  },
  render: args => (
    <Reasoning {...args}>
      <ReasoningTrigger />
      <ReasoningContent>{reasoningText}</ReasoningContent>
    </Reasoning>
  ),
};

/** Collapsed resting state — how it appears inside a completed message. */
export const Collapsed: Story = {
  args: {
    defaultOpen: false,
    duration: 12,
  },
  render: args => (
    <Reasoning {...args}>
      <ReasoningTrigger />
      <ReasoningContent>{reasoningText}</ReasoningContent>
    </Reasoning>
  ),
};

/**
 * While `isStreaming`, the trigger shimmers "Thinking..." and the panel is
 * held open so users can watch the reasoning arrive.
 */
export const Streaming: Story = {
  args: {
    isStreaming: true,
  },
  render: args => (
    <Reasoning {...args}>
      <ReasoningTrigger />
      <ReasoningContent>
        {
          'Matching the workload image tag `sha-4f21c` against recent commits in github-repositories...'
        }
      </ReasoningContent>
    </Reasoning>
  ),
};
