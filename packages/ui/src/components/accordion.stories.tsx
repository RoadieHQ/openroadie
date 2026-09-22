import type { Meta, StoryObj } from '@storybook/react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './accordion';

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Accordion>;

export default meta;
// Against the component, not `typeof meta`: deriving the args type from meta
// makes every prop of the union required, so a `render`-only story cannot
// satisfy it (see sidebar-nav-item.stories.tsx in packages/app for the same
// fix).
type Story = StoryObj<typeof Accordion>;

export const Single: Story = {
  render: () => (
    <Accordion type="single" collapsible className="w-96">
      <AccordionItem value="schedule">
        <AccordionTrigger>Schedule</AccordionTrigger>
        <AccordionContent>
          Runs every hour; retries with backoff on failure.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="auth">
        <AccordionTrigger>Authentication</AccordionTrigger>
        <AccordionContent>
          Uses the GitHub App installation for this workspace.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="filters">
        <AccordionTrigger>Filters</AccordionTrigger>
        <AccordionContent>
          Only repositories with the <code>catalog</code> topic are ingested.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

/** `type="multiple"` keeps several sections open at once. */
export const Multiple: Story = {
  render: () => (
    <Accordion type="multiple" defaultValue={['schedule']} className="w-96">
      <AccordionItem value="schedule">
        <AccordionTrigger>Schedule</AccordionTrigger>
        <AccordionContent>Runs every hour.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="auth">
        <AccordionTrigger>Authentication</AccordionTrigger>
        <AccordionContent>GitHub App installation.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
