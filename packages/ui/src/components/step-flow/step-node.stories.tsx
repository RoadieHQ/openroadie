import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Database, GitBranch, Play } from 'lucide-react';
import { StepNode, type StepStatus } from './step-node';
import { FlowConnector } from './flow-connector';

/** Pipeline-editor node. Status drives the accent; variant names the role. */
const meta = {
  title: 'StepFlow/StepNode',
  component: StepNode,
  parameters: { layout: 'centered' },
  args: {
    onToggle: fn(),
  },
} satisfies Meta<typeof StepNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: <Database className="size-4" />,
    title: 'GitHub repositories',
    subtitle: 'Source · runs hourly',
    status: 'configured',
    variant: 'source',
    expanded: false,
  },
  render: function Render(args) {
    const [expanded, setExpanded] = useState(args.expanded);
    return (
      <div className="w-96">
        <StepNode
          {...args}
          expanded={expanded}
          onToggle={() => setExpanded(e => !e)}
        >
          <p className="text-sm text-muted-foreground">
            Step configuration renders here when expanded.
          </p>
        </StepNode>
      </div>
    );
  },
};

export const Statuses: Story = {
  args: {
    icon: <Database className="size-4" />,
    title: 'GitHub repositories',
    status: 'pending',
    variant: 'source',
    expanded: false,
  },
  render: args => (
    <div className="w-96 space-y-2">
      {(
        [
          'pending',
          'configured',
          'running',
          'success',
          'error',
          'warning',
        ] satisfies StepStatus[]
      ).map(status => (
        <StepNode
          {...args}
          key={status}
          title={`Status: ${status}`}
          status={status}
        />
      ))}
    </div>
  ),
};

/** A miniature pipeline: nodes joined by `FlowConnector`s. */
export const InFlow: Story = {
  args: {
    icon: <Play className="size-4" />,
    title: 'Trigger',
    status: 'success',
    variant: 'trigger',
    expanded: false,
    onDelete: fn(),
  },
  render: args => (
    <div className="flex w-96 flex-col">
      <StepNode {...args} subtitle="Hourly schedule" />
      <FlowConnector state="completed" />
      <StepNode
        {...args}
        icon={<Database className="size-4" />}
        title="GitHub repositories"
        subtitle="Source"
        variant="source"
        status="running"
      />
      <FlowConnector state="flowing" label="1,204 objects" />
      <StepNode
        {...args}
        icon={<GitBranch className="size-4" />}
        title="Catalog datastore"
        subtitle="Sink"
        variant="sink"
        status="pending"
      />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    icon: <Database className="size-4" />,
    title: 'PagerDuty services',
    status: 'pending',
    variant: 'source',
    expanded: false,
    disabled: true,
    disabledReason: 'Connect the PagerDuty integration first',
  },
  render: args => (
    <div className="w-96">
      <StepNode {...args} />
    </div>
  ),
};
