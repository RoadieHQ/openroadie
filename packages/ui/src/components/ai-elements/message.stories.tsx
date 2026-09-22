import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { CopyIcon, RefreshCcwIcon } from 'lucide-react';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from './message';

/**
 * A single chat turn. `from` decides alignment and surface: user messages sit
 * right in a bubble, assistant messages render full-width as prose — use it
 * for every entry in a conversation thread.
 */
const meta = {
  title: 'AiElements/Message',
  component: Message,
  parameters: { layout: 'centered' },
  args: {
    from: 'assistant',
  },
  decorators: [
    Story => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
  args: {
    from: 'user',
  },
  render: args => (
    <Message {...args}>
      <MessageContent>
        Which data sources feed the checkout relationship rule?
      </MessageContent>
    </Message>
  ),
};

/**
 * Assistant replies render Markdown through `MessageResponse` so lists,
 * code, and emphasis in model output display correctly.
 */
export const AssistantMessage: Story = {
  render: args => (
    <Message {...args}>
      <MessageContent>
        <MessageResponse>
          {`The **checkout** relationship rule joins two data sources:

1. \`aws-eks-clusters\` — provides the running workloads
2. \`github-repositories\` — provides the source repositories

It matches on the deployed image tag against the latest commit SHA.`}
        </MessageResponse>
      </MessageContent>
    </Message>
  ),
};

/** Hover actions (copy, retry) belong in a toolbar under the response. */
export const WithActions: Story = {
  render: args => (
    <Message {...args}>
      <MessageContent>
        <MessageResponse>
          payment-service is owned by the Payments Platform team.
        </MessageResponse>
      </MessageContent>
      <MessageToolbar>
        <MessageActions>
          <MessageAction tooltip="Copy" onClick={fn()}>
            <CopyIcon className="size-4" />
          </MessageAction>
          <MessageAction tooltip="Regenerate" onClick={fn()}>
            <RefreshCcwIcon className="size-4" />
          </MessageAction>
        </MessageActions>
      </MessageToolbar>
    </Message>
  ),
};

/**
 * When a response was regenerated, `MessageBranch` lets users page between
 * the alternatives without losing any of them.
 */
export const Branching: Story = {
  render: args => (
    <MessageBranch defaultBranch={0} onBranchChange={fn()}>
      <MessageBranchContent>
        <Message {...args} key="branch-1">
          <MessageContent>
            The rule matches workloads to repositories by image tag.
          </MessageContent>
        </Message>
        <Message {...args} key="branch-2">
          <MessageContent>
            Workloads link to repositories via the deployed commit SHA embedded
            in the image tag.
          </MessageContent>
        </Message>
      </MessageBranchContent>
      <MessageBranchSelector className="flex items-center gap-1">
        <MessageBranchPrevious />
        <MessageBranchPage />
        <MessageBranchNext />
      </MessageBranchSelector>
    </MessageBranch>
  ),
};
