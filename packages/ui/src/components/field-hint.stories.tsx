import type { Meta, StoryObj } from '@storybook/react';
import { FieldHint } from './field-hint';
import { Label } from './label';
import { Input } from './input';

/**
 * Compact help affordance beside a field label — keeps dense forms tight
 * while leaving guidance one hover away.
 */
const meta = {
  title: 'Form/FieldHint',
  component: FieldHint,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FieldHint>;

export default meta;
// Against the component, not `typeof meta`: deriving the args type from meta
// makes every prop of the union required, so a `render`-only story cannot
// satisfy it (see sidebar-nav-item.stories.tsx in packages/app for the same
// fix).
type Story = StoryObj<typeof FieldHint>;

export const Default: Story = {
  args: {
    children:
      'The slug is used in URLs and API calls. Lowercase, hyphen-separated.',
  },
};

export const BesideLabel: Story = {
  render: () => (
    <div className="w-64 space-y-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor="hint-slug">Slug</Label>
        <FieldHint ariaLabel="About slugs">
          Used in URLs and API calls. Lowercase, hyphen-separated, immutable
          after creation.
        </FieldHint>
      </div>
      <Input id="hint-slug" placeholder="payments-team" />
    </div>
  ),
};

/** `onField` paints the trigger with `--field-bg` so it can overlap a field's border. */
export const OnField: Story = {
  args: {
    size: 'md',
    onField: true,
    contentClassName: 'max-w-[320px]',
    children:
      'Broader read access gives richer context; add write permissions only when you need them.',
  },
};
