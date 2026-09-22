import type { Meta, StoryObj } from '@storybook/react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip';
import { Button } from './button';

/** The preview wraps stories in `TooltipProvider`; the app does the same at root. */
const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover me</Button>
      </TooltipTrigger>
      <TooltipContent>Runs the pipeline against live data</TooltipContent>
    </Tooltip>
  ),
};

export const OnIcon: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="What is a data source?">
          <HelpCircle />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">
        A data source ingests objects from one integration on a schedule.
      </TooltipContent>
    </Tooltip>
  ),
};
