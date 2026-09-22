import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './tool';

const searchInput = {
  query: 'payment-service',
  datasource: 'aws-eks-clusters',
};

const searchOutput = {
  results: [
    {
      id: 'wl-payment-service',
      kind: 'Deployment',
      namespace: 'payments',
      image: 'roadie/payment-service:sha-4f21c',
    },
  ],
  total: 1,
};

/**
 * Collapsible record of a single agent tool call. Use one per call inside an
 * assistant message so users can verify what the agent invoked, with which
 * input, and what came back — status is readable at a glance from the header.
 */
const meta = {
  title: 'AiElements/Tool',
  component: Tool,
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
} satisfies Meta<typeof Tool>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A completed call, expanded to show input and output payloads. */
export const Completed: Story = {
  args: {
    defaultOpen: true,
  },
  render: args => (
    <Tool {...args}>
      <ToolHeader type="tool-explore_objects_search" state="output-available" />
      <ToolContent>
        <ToolInput input={searchInput} />
        <ToolOutput output={searchOutput} errorText={undefined} />
      </ToolContent>
    </Tool>
  ),
};

/** While the call runs, the header shows a spinner instead of a result icon. */
export const Running: Story = {
  render: args => (
    <Tool {...args}>
      <ToolHeader type="tool-explore_objects_search" state="input-available" />
      <ToolContent>
        <ToolInput input={searchInput} />
      </ToolContent>
    </Tool>
  ),
};

/** Failures surface the error text alongside whatever input was sent. */
export const Failed: Story = {
  args: {
    defaultOpen: true,
  },
  render: args => (
    <Tool {...args}>
      <ToolHeader
        type="tool-explore_relationship_rule_dry_run"
        state="output-error"
      />
      <ToolContent>
        <ToolInput input={{ ruleId: 'rel-rule-checkout' }} />
        <ToolOutput
          output={undefined}
          errorText="Data source aws-eks-clusters is unreachable: integration credentials expired"
        />
      </ToolContent>
    </Tool>
  ),
};

/**
 * Dynamic (MCP) tools have no static type — pass `toolName` so the header
 * can label the call; `title` overrides the derived name entirely.
 */
export const DynamicTool: Story = {
  args: {
    defaultOpen: true,
  },
  render: args => (
    <Tool {...args}>
      <ToolHeader
        type="dynamic-tool"
        toolName="manage_relationship_rule_create"
        state="output-available"
        title="Create relationship rule"
      />
      <ToolContent>
        <ToolInput
          input={{
            source: 'aws-eks-clusters',
            target: 'github-repositories',
            relation: 'deployedFrom',
          }}
        />
        <ToolOutput
          output={{ ruleId: 'rel-rule-9f2', state: 'suggested' }}
          errorText={undefined}
        />
      </ToolContent>
    </Tool>
  ),
};
