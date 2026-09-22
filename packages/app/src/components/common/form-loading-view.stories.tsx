import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardHeader, CardTitle } from '@roadiehq/ui/card';
import { FormLoadingView } from './form-loading-view';

/**
 * Labeled-field skeletons for the form/detail-card archetype. Render inside
 * the real `Card` so the header stays put. See `.claude/rules/loading-states.md`.
 */
const meta = {
  title: 'Common/FormLoadingView',
  component: FormLoadingView,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FormLoadingView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    fields: 4,
  },
};

export const InsideCard: Story = {
  args: {
    fields: 3,
  },
  render: args => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Integration settings</CardTitle>
      </CardHeader>
      <CardContent>
        <FormLoadingView {...args} />
      </CardContent>
    </Card>
  ),
};
