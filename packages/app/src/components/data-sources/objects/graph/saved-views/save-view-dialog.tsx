import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { FormDialog, useResetFormOnOpen, useZodForm } from '../../../../common';
import { saveViewFormSchema } from './saved-view-schema';

const defaultValues = { name: '' };

/** Names and saves the current graph view. Duplicate names surface as a
 * field error (never a toast — forms.md). */
export function SaveViewDialog({
  open,
  onOpenChange,
  existingNames,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingNames: readonly string[];
  onSave: (name: string) => void;
}) {
  const form = useZodForm({ schema: saveViewFormSchema, defaultValues });
  useResetFormOnOpen(form, open, () => defaultValues);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save graph view"
      description="Snapshots the mode, filters, focused objects, expansions and camera."
      form={form}
      submitLabel="Save view"
      onSubmit={values => {
        const name = values.name.trim();
        if (existingNames.some(existing => existing === name)) {
          form.setError('name', {
            message: 'A view with this name already exists',
          });
          return;
        }
        onSave(name);
        onOpenChange(false);
      }}
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <OutlinedInput
                label="View name *"
                placeholder="e.g. Payments blast radius"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}
