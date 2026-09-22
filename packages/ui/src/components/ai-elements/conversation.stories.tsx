import type { Meta, StoryObj } from '@storybook/react';
import type { UIMessage } from 'ai';
import { MessageSquareIcon } from 'lucide-react';
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
} from './conversation';
import { Message, MessageContent } from './message';

const messages: UIMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    parts: [
      {
        type: 'text',
        text: 'Which team owns the payment-service deployment?',
      },
    ],
  },
  {
    id: 'msg-2',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: 'payment-service is owned by the Payments Platform team. The deployment traces to PR #318 in roadie/payment-service, merged by Ana Costa.',
      },
    ],
  },
  {
    id: 'msg-3',
    role: 'user',
    parts: [
      {
        type: 'text',
        text: 'What is the blast radius if we roll back that PR?',
      },
    ],
  },
  {
    id: 'msg-4',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: 'Rolling back PR #318 affects 3 tenants running the sha-4f21c image and reverts the new retry logic on the checkout relationship rule.',
      },
    ],
  },
];

/**
 * Scroll container for a chat thread. It pins to the bottom as new messages
 * stream in and offers a scroll-to-bottom affordance when the user scrolls
 * up — use it as the outer shell of any assistant conversation.
 */
const meta = {
  title: 'AiElements/Conversation',
  component: Conversation,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div className="flex h-96 w-[32rem] flex-col rounded-md border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Conversation>;

export default meta;
// Against the component, not `typeof meta`: deriving the args type from meta
// makes every prop of the union required, so a `render`-only story cannot
// satisfy it (see sidebar-nav-item.stories.tsx in packages/app for the same
// fix).
type Story = StoryObj<typeof Conversation>;

export const Default: Story = {
  render: args => (
    <Conversation {...args}>
      <ConversationContent>
        {messages.map(message => (
          <Message from={message.role} key={message.id}>
            <MessageContent>
              {message.parts
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('')}
            </MessageContent>
          </Message>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  ),
};

/** Shown before the first message — orient the user toward a first question. */
export const EmptyState: Story = {
  render: args => (
    <Conversation {...args}>
      <ConversationEmptyState
        icon={<MessageSquareIcon className="size-8" />}
        title="Ask about your catalog"
        description="Try: who owns payment-service, or what changed in the last deploy"
      />
    </Conversation>
  ),
};

/**
 * The download button exports the thread as Markdown — useful for attaching
 * an investigation transcript to an incident ticket.
 */
export const WithDownload: Story = {
  render: args => (
    <Conversation {...args}>
      <ConversationContent>
        {messages.map(message => (
          <Message from={message.role} key={message.id}>
            <MessageContent>
              {message.parts
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('')}
            </MessageContent>
          </Message>
        ))}
      </ConversationContent>
      <ConversationDownload
        messages={messages}
        filename="ownership-investigation.md"
      />
    </Conversation>
  ),
};
