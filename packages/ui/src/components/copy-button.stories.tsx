import type { Meta, StoryObj } from '@storybook/react';
import { CopyButton } from './copy-button';
import { InlineCode } from './inline-code';

/**
 * Click to copy; the icon swaps to a success check for two seconds. Pass a
 * getter as `value` when serializing is expensive (JSON payloads, CSV).
 */
const meta = {
  title: 'Components/CopyButton',
  component: CopyButton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof CopyButton>;

export default meta;
// Against the component, not `typeof meta`: deriving the args type from meta
// makes every prop of the union required, so a `render`-only story cannot
// satisfy it (see sidebar-nav-item.stories.tsx in packages/app for the same
// fix).
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {
  args: {
    value: 'https://api.roadie.io/mcp/v1/catalog/',
    label: 'Copy endpoint URL',
  },
};

export const BesideCode: Story = {
  render: () => (
    <div className="flex items-center gap-1 text-sm">
      <InlineCode>yarn dlx @roadiehq/cli init</InlineCode>
      <CopyButton value="yarn dlx @roadiehq/cli init" label="Copy command" />
    </div>
  ),
};
