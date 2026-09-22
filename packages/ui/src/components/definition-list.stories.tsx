import type { Meta, StoryObj } from '@storybook/react';
import { DefinitionList, DefinitionItem } from './definition-list';
import { Badge } from './badge';

const meta = {
  title: 'Components/DefinitionList',
  component: DefinitionList,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 360, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DefinitionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <DefinitionList>
      <DefinitionItem label="Status">
        <Badge variant="success">Active</Badge>
      </DefinitionItem>
      <DefinitionItem label="Objects">1,204</DefinitionItem>
      <DefinitionItem label="Last run">2 hours ago</DefinitionItem>
      <DefinitionItem label="Description">
        Syncs customer records from the billing provider every 15 minutes.
      </DefinitionItem>
      <DefinitionItem label="Owner" />
    </DefinitionList>
  ),
};
