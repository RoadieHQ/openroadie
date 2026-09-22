import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { useForm } from 'react-hook-form';
import { OutlinedSelect } from './outlined-select';
import { SelectItem } from './select';
import { Form, FormControl, FormField, FormItem, FormMessage } from './form';

function SelectWithItems(props: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
}) {
  return (
    <OutlinedSelect {...props}>
      <SelectItem value="other" className="px-4 py-1.5 text-base">
        Other
      </SelectItem>
      <SelectItem value="ci-cd" className="px-4 py-1.5 text-base">
        CI / CD
      </SelectItem>
      <SelectItem value="monitoring" className="px-4 py-1.5 text-base">
        Monitoring
      </SelectItem>
      <SelectItem value="infrastructure" className="px-4 py-1.5 text-base">
        Infrastructure
      </SelectItem>
    </OutlinedSelect>
  );
}

const meta = {
  title: 'Form/OutlinedSelect',
  component: SelectWithItems,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 400, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SelectWithItems>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Type',
    value: 'other',
    onValueChange: fn(),
  },
};

export const WithSelection: Story = {
  args: {
    label: 'Backend',
    value: 'monitoring',
    onValueChange: fn(),
  },
};

function FormWrapped(props: { label: string }) {
  const form = useForm<{ category: string }>({
    defaultValues: { category: 'other' },
  });

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="category"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <OutlinedSelect
                label={props.label}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectItem value="other" className="px-4 py-1.5 text-base">
                  Other
                </SelectItem>
                <SelectItem value="ci-cd" className="px-4 py-1.5 text-base">
                  CI / CD
                </SelectItem>
              </OutlinedSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}

export const InsideFormControl: Story = {
  args: {
    label: 'Category',
    value: 'other',
    onValueChange: fn(),
  },
  render: args => <FormWrapped label={args.label} />,
};
