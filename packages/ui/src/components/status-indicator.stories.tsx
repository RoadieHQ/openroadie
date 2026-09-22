import type { Meta, StoryObj } from '@storybook/react';
import {
  StatusCell,
  StatusDot,
  type StatusIndicatorTone,
} from './status-indicator';

const ALL_TONES: StatusIndicatorTone[] = [
  'neutral',
  'info',
  'success',
  'destructive',
  'warning',
];

/**
 * Tone-coloured status dot + optional label. Domain code maps its own status
 * vocabulary (execution states, readiness, lifecycle, …) to a semantic tone;
 * `pulse` marks in-flight states, `glow` suits dot-only cells.
 */
const meta = {
  title: 'Components/StatusIndicator',
  component: StatusCell,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof StatusCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tone: 'success',
    label: 'Completed',
  },
};

export const AllTones: Story = {
  args: { tone: 'neutral', label: 'Pending' },
  render: () => (
    <div className="space-y-2">
      {ALL_TONES.map(tone => (
        <StatusCell key={tone} tone={tone} label={tone} />
      ))}
    </div>
  ),
};

/** `pulse` marks an in-flight state, e.g. a running execution. */
export const Running: Story = {
  args: {
    tone: 'info',
    label: 'Running',
    pulse: true,
  },
};

/** Bare dots, with `glow` for dot-only cells where the dot is the whole signal. */
export const Dots: Story = {
  args: { tone: 'neutral', label: '' },
  render: () => (
    <div className="flex items-center gap-3">
      {ALL_TONES.map(tone => (
        <StatusDot key={tone} tone={tone} glow />
      ))}
    </div>
  ),
};
