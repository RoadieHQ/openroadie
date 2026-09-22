import type { Meta, StoryObj } from '@storybook/react';
import { Shimmer } from './shimmer';

/**
 * Animated text sweep for indeterminate AI activity — "thinking", "searching
 * the catalog". Use it instead of a spinner when there is a short status
 * phrase to show; the highlight width scales with the text via `spread`.
 */
const meta = {
  title: 'AiElements/Shimmer',
  component: Shimmer,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Shimmer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Thinking...',
  },
};

/** Longer status lines read naturally too — the sweep spans the full text. */
export const StatusMessage: Story = {
  args: {
    children: 'Searching the catalog for matching Kubernetes workloads...',
  },
};

/** `as` renders any element; `duration` slows or speeds the sweep. */
export const CustomElementAndSpeed: Story = {
  args: {
    as: 'span',
    duration: 4,
    children: 'Applying relationship rule to 3,410 objects',
    className: 'text-lg font-medium',
  },
};
