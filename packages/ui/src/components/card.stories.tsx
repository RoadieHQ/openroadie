import type { Meta, StoryObj } from '@storybook/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './card';
import { Button } from './button';
import { Badge } from './badge';

/**
 * The standard surface. Prefer this over hand-rolled `bg-card` divs — it also
 * sets `--field-bg` so floating-label fields inside it render correctly.
 */
const meta = {
  title: 'Components/Card',
  component: Card,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Payments API</CardTitle>
        <CardDescription>REST integration · runs hourly</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="successOutline">Healthy</Badge>
          <span>1,204 objects</span>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" size="sm">
          View objects
        </Button>
        <Button size="sm">Open editor</Button>
      </CardFooter>
    </Card>
  ),
};

/**
 * `variant="floating"` is for panels that sit *over* content — graph toolbars,
 * legends, canvas overlays. Larger radius and a deeper shadow lift them off the
 * surface behind, and every floating panel shares the treatment.
 */
export const Floating: Story = {
  render: () => (
    <div className="flex items-start gap-6">
      <Card className="w-56 p-4 text-sm">
        <p className="font-medium">Default</p>
        <p className="text-muted-foreground">In-page surface.</p>
      </Card>
      <Card variant="floating" className="w-56 p-4 text-sm">
        <p className="font-medium">Floating</p>
        <p className="text-muted-foreground">Sits over a canvas.</p>
      </Card>
    </div>
  ),
};
