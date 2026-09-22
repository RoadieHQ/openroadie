import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Plus, Sparkles, Users, Zap } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { OverviewEmptyPreview } from './overview-empty-preview';
import {
  GhostTablePreview,
  ghostTransitionCell,
  type GhostRow,
} from './ghost-table-preview';

const actionRows: GhostRow[] = [
  [
    { kind: 'icon', icon: Zap },
    {
      kind: 'title',
      text: 'Create a Jira ticket',
      subtext: 'create-jira-ticket',
    },
    { kind: 'badge', text: 'POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: '2h ago' },
  ],
  [
    { kind: 'icon', icon: Zap },
    { kind: 'title', text: 'Trigger a deployment', subtext: 'trigger-deploy' },
    { kind: 'badge', text: 'GET+POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: 'Yesterday' },
  ],
  [
    { kind: 'icon', icon: Zap },
    {
      kind: 'title',
      text: 'Post a message to Slack',
      subtext: 'post-to-slack',
    },
    { kind: 'badge', text: 'POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: '3d ago' },
  ],
];

const capabilityRows: GhostRow[] = [
  [
    { kind: 'icon', icon: Sparkles },
    { kind: 'title', text: 'Triage an incident' },
    { kind: 'badge', text: 'v1' },
    { kind: 'text', text: '4h ago' },
  ],
  [
    { kind: 'icon', icon: Sparkles },
    { kind: 'title', text: 'Draft release notes' },
    { kind: 'badge', text: 'v2' },
    { kind: 'text', text: 'Yesterday' },
  ],
  [
    { kind: 'icon', icon: Sparkles },
    { kind: 'title', text: 'Summarize open pull requests' },
    { kind: 'badge', text: 'v1' },
    { kind: 'text', text: '1w ago' },
  ],
];

const contextGroupRows: GhostRow[] = [
  [
    { kind: 'icon', icon: Users },
    { kind: 'title', text: 'Everything owned by a team' },
    ghostTransitionCell('0 roots · 0 associated', '2 roots · 14 associated'),
    { kind: 'text', text: '1h ago' },
  ],
  [
    { kind: 'icon', icon: Users },
    { kind: 'title', text: 'All resources for a service' },
    ghostTransitionCell('0 roots · 0 associated', '1 root · 9 associated'),
    { kind: 'text', text: 'Yesterday' },
  ],
  [
    { kind: 'icon', icon: Users },
    { kind: 'title', text: 'Staging infrastructure' },
    ghostTransitionCell('0 roots · 0 associated', '3 roots · 27 associated'),
    { kind: 'text', text: '5d ago' },
  ],
];

const meta = {
  title: 'Overview/OverviewEmptyPreview',
  component: OverviewEmptyPreview,
  parameters: {
    layout: 'fullscreen',
    a11y: {
      // GhostTablePreview settles at opacity 0.4 by design (~2.4:1). axe checks
      // contrast even on aria-hidden content, so exclude that subtree only —
      // the empty state's own text stays checked.
      context: { exclude: [['[aria-hidden="true"]']] },
    },
  },
  argTypes: {
    action: { control: false },
    preview: { control: false },
  },
  decorators: [
    Story => (
      <div className="flex h-[640px] flex-col p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OverviewEmptyPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
  args: {
    title: 'No actions yet',
    description:
      'Reusable, parameterized HTTP operations that run against your integrations.',
    preview: (
      <GhostTablePreview
        headers={['Name', 'Steps', 'Status', 'Updated']}
        columns="2.5rem minmax(0,1fr) 6rem 6rem 5.5rem"
        rows={actionRows}
      />
    ),
    action: (
      <Button>
        <Plus className="size-4" />
        New Action
      </Button>
    ),
  },
};

export const Capabilities: Story = {
  args: {
    title: 'No capabilities yet',
    description:
      'Reusable instructions that guide agents through repeatable workflows.',
    preview: (
      <GhostTablePreview
        headers={['Name', 'Version', 'Updated']}
        columns="2.5rem minmax(0,1fr) 5rem 5.5rem"
        rows={capabilityRows}
      />
    ),
    action: (
      <Button>
        <Plus className="size-4" />
        New Capability
      </Button>
    ),
  },
};

export const ContextGroups: Story = {
  args: {
    title: 'No context groups yet',
    description: 'Rules that group related objects together.',
    preview: (
      <GhostTablePreview
        headers={['Name', 'Sources', 'Updated']}
        columns="2.5rem minmax(0,1fr) 11rem 5.5rem"
        rows={contextGroupRows}
      />
    ),
    action: (
      <Button>
        <Plus className="size-4" />
        New Context Group
      </Button>
    ),
  },
};
