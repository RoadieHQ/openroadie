import type { Meta, StoryObj } from '@storybook/react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from './alert';

const meta = {
  title: 'Components/Alert',
  component: Alert,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert className="w-96">
      <Info className="size-4" />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        Schema changes apply on the next scheduled run.
      </AlertDescription>
    </Alert>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="w-96 space-y-3">
      <Alert variant="destructive">
        <XCircle className="size-4" />
        <AlertTitle>Run failed</AlertTitle>
        <AlertDescription>Authentication to GitHub expired.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <CheckCircle2 className="size-4" />
        <AlertTitle>Connected</AlertTitle>
        <AlertDescription>1,204 objects ingested.</AlertDescription>
      </Alert>
      <Alert variant="warning">
        <AlertTriangle className="size-4" />
        <AlertTitle>Rate limited</AlertTitle>
        <AlertDescription>Retrying with backoff.</AlertDescription>
      </Alert>
      <Alert variant="info">
        <Info className="size-4" />
        <AlertTitle>Preview</AlertTitle>
        <AlertDescription>This rule is in suggested state.</AlertDescription>
      </Alert>
    </div>
  ),
};
