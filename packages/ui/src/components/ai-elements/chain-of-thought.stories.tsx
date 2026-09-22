import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { DatabaseIcon, GitBranchIcon, SearchIcon } from 'lucide-react';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from './chain-of-thought';

/**
 * Collapsible timeline of an AI agent's intermediate steps. Use it to let
 * users audit how the assistant arrived at an answer without cluttering the
 * conversation by default.
 */
const meta = {
  title: 'AiElements/ChainOfThought',
  component: ChainOfThought,
  parameters: { layout: 'centered' },
  args: {
    onOpenChange: fn(),
  },
  decorators: [
    Story => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChainOfThought>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Expanded by default so the full step timeline is visible for review. */
export const Default: Story = {
  args: {
    defaultOpen: true,
  },
  render: args => (
    <ChainOfThought {...args}>
      <ChainOfThoughtHeader />
      <ChainOfThoughtContent>
        <ChainOfThoughtStep
          icon={SearchIcon}
          label="Searching the catalog for Kubernetes workloads"
          description="Query: deployment name contains payment-service"
        >
          <ChainOfThoughtSearchResults>
            <ChainOfThoughtSearchResult>
              payment-service
            </ChainOfThoughtSearchResult>
            <ChainOfThoughtSearchResult>
              payment-service-worker
            </ChainOfThoughtSearchResult>
          </ChainOfThoughtSearchResults>
        </ChainOfThoughtStep>
        <ChainOfThoughtStep
          icon={GitBranchIcon}
          label="Tracing deployed commit to its pull request"
          description="Matched image tag sha-4f21c to PR #318"
        />
        <ChainOfThoughtStep
          icon={DatabaseIcon}
          label="Resolving owning team from the repository data source"
        />
      </ChainOfThoughtContent>
    </ChainOfThought>
  ),
};

/** Collapsed by default — the resting state inside a finished message. */
export const Collapsed: Story = {
  render: args => (
    <ChainOfThought {...args}>
      <ChainOfThoughtHeader>Analyzed 3 data sources</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        <ChainOfThoughtStep label="Listed data sources" />
        <ChainOfThoughtStep label="Compared object schemas" />
        <ChainOfThoughtStep label="Proposed a relationship rule" />
      </ChainOfThoughtContent>
    </ChainOfThought>
  ),
};

/**
 * Step status communicates progress while the agent is still working:
 * `complete` dims, `active` highlights, `pending` fades out.
 */
export const StepStatuses: Story = {
  args: {
    defaultOpen: true,
  },
  render: args => (
    <ChainOfThought {...args}>
      <ChainOfThoughtHeader>Applying relationship rule</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        <ChainOfThoughtStep
          status="complete"
          label="Fetched objects from aws-eks-clusters"
        />
        <ChainOfThoughtStep
          status="active"
          label="Matching workloads to GitHub repositories"
          description="1,204 of 3,410 objects processed"
        />
        <ChainOfThoughtStep
          status="pending"
          label="Writing relationship edges"
        />
      </ChainOfThoughtContent>
    </ChainOfThought>
  ),
};
