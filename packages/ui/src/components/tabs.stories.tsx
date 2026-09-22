import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { defaultValue: 'overview', onValueChange: fn() },
  render: args => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="objects">Objects</TabsTrigger>
        <TabsTrigger value="runs">Runs</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-sm text-muted-foreground">
        Summary of this data source.
      </TabsContent>
      <TabsContent value="objects" className="text-sm text-muted-foreground">
        1,204 ingested objects.
      </TabsContent>
      <TabsContent value="runs" className="text-sm text-muted-foreground">
        Recent execution history.
      </TabsContent>
    </Tabs>
  ),
};
