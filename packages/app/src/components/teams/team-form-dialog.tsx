import React from 'react';
import { useFormState } from 'react-hook-form';
import { z } from 'zod';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { FormDialog, useResetFormOnOpen, useZodForm } from '../common';
import type { Team } from '../../api';
import { useTeamMutations } from './use-team-mutations';

const SLUG_MESSAGE =
  'Lowercase letters, numbers and single hyphens — no leading or trailing hyphen';

function isValidSlug(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value) && !/(^-|-$|--)/.test(value);
}

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200, 'Name must be at most 200 characters');

const createSchema = z.object({
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .refine(isValidSlug, SLUG_MESSAGE),
});
const editSchema = z.object({ name: nameSchema });

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface TeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeamCreateDialog({ open, onOpenChange }: TeamDialogProps) {
  const { createTeam } = useTeamMutations();
  const form = useZodForm({
    schema: createSchema,
    defaultValues: { name: '', slug: '' },
  });
  useResetFormOnOpen(form, open, () => ({ name: '', slug: '' }));
  const { dirtyFields } = useFormState({
    control: form.control,
    name: 'slug',
  });
  const slugIsDerived = !dirtyFields.slug;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New team"
      description="Create a team workspace, then choose who can access it."
      form={form}
      submitLabel="Create team"
      onSubmit={async values => {
        await createTeam(values);
        onOpenChange(false);
      }}
    >
      <div className="flex flex-col gap-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <OutlinedInput
                  label="Name *"
                  {...field}
                  onChange={event => {
                    field.onChange(event);
                    if (slugIsDerived) {
                      form.setValue('slug', slugify(event.target.value), {
                        shouldValidate: true,
                      });
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <OutlinedInput label="Slug *" {...field} />
              </FormControl>
              <FormDescription>
                Permanent identifier for this team.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </FormDialog>
  );
}

export function TeamEditDialog({
  open,
  onOpenChange,
  team,
}: TeamDialogProps & { team: Team }) {
  const { updateTeam } = useTeamMutations();
  const form = useZodForm({
    schema: editSchema,
    defaultValues: { name: team.name },
  });
  useResetFormOnOpen(form, open, () => ({ name: team.name }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${team.name}`}
      form={form}
      submitLabel="Save"
      onSubmit={async values => {
        await updateTeam({ id: team.id, input: values });
        onOpenChange(false);
      }}
    >
      <div className="flex flex-col gap-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <OutlinedInput label="Name *" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-2">
          <OutlinedInput label="Slug" value={team.slug} readOnly disabled />
          <p className="text-sm text-muted-foreground">
            The slug is fixed after creation.
          </p>
        </div>
      </div>
    </FormDialog>
  );
}
