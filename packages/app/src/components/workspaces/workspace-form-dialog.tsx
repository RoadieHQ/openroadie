import React from 'react';
import {
  useFormState,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
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
import type { Workspace } from '../../api';
import { useWorkspaceMutations } from './use-workspace-mutations';
import { WorkspaceSvgField } from './workspace-svg-field';

/** Mirrors MAX_WORKSPACE_SVG_BYTES in the workspaces backend. */
const MAX_SVG_BYTES = 64 * 1024;

const SLUG_MESSAGE =
  'Lowercase letters, numbers and single hyphens — no leading or trailing hyphen';

// The backend's grammar (SLUG_SOURCE in @roadiehq/scopes-common) expressed as
// two flat checks rather than one nested-quantifier regex, which
// security/detect-unsafe-regex rejects.
function isValidSlug(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value) && !/(^-|-$|--)/.test(value);
}

const svgSchema = z
  .string()
  .nullable()
  .refine(value => value === null || /^\s*<svg[\s>]/i.test(value), {
    message: 'That file is not SVG markup',
  })
  .refine(value => value === null || new Blob([value]).size <= MAX_SVG_BYTES, {
    message: `The mark must be at most ${MAX_SVG_BYTES / 1024}KB`,
  });

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
  type: z.literal('personal'),
  svg: svgSchema,
});

const editSchema = z.object({ name: nameSchema, svg: svgSchema });

/** Derives a slug from a name, matching the backend's grammar. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Shared by the create and edit forms, whose schemas differ in everything
 *  but this field. */
function SvgField<TFieldValues extends FieldValues>({
  control,
}: {
  control: Control<TFieldValues>;
}) {
  return (
    <FormField
      control={control}
      name={'svg' as FieldPath<TFieldValues>}
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <WorkspaceSvgField
              value={(field.value as string | null) ?? null}
              onChange={field.onChange}
            />
          </FormControl>
          <FormDescription>
            A square SVG, shown beside the workspace name in the sidebar.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface WorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: WorkspaceDialogProps & { onCreated?: (workspace: Workspace) => void }) {
  const { createWorkspace } = useWorkspaceMutations();
  const form = useZodForm({
    schema: createSchema,
    defaultValues: {
      name: '',
      slug: '',
      type: 'personal' as const,
      svg: null,
    },
  });

  useResetFormOnOpen(form, open, () => ({
    name: '',
    slug: '',
    type: 'personal' as const,
    svg: null,
  }));

  // The slug is fixed at create, so it is derived while the user types and
  // stops following the name once they edit it themselves.
  const { dirtyFields } = useFormState({
    control: form.control,
    name: 'slug',
  });
  const slugIsDerived = !dirtyFields.slug;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New workspace"
      form={form}
      submitLabel="Create workspace"
      onSubmit={async values => {
        const workspace = await createWorkspace(values);
        onOpenChange(false);
        onCreated?.(workspace);
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
                Permanent — a slug is an address, so it cannot be changed later.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <SvgField control={form.control} />
      </div>
    </FormDialog>
  );
}

export function WorkspaceEditDialog({
  open,
  onOpenChange,
  workspace,
}: WorkspaceDialogProps & { workspace: Workspace }) {
  const { updateWorkspace } = useWorkspaceMutations();
  const form = useZodForm({
    schema: editSchema,
    defaultValues: { name: workspace.name, svg: workspace.svg },
  });

  useResetFormOnOpen(form, open, () => ({
    name: workspace.name,
    svg: workspace.svg,
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${workspace.name}`}
      form={form}
      submitLabel="Save"
      onSubmit={async values => {
        await updateWorkspace({ id: workspace.id, input: values });
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

        {/* Not a form field: the slug cannot change, so it is shown rather
            than edited. The Form* primitives need a FormField ancestor. */}
        <div className="flex flex-col gap-2">
          <OutlinedInput
            label="Slug"
            value={workspace.slug}
            readOnly
            disabled
          />
          <p className="text-sm text-muted-foreground">
            A slug is an address, so it is fixed at creation.
          </p>
        </div>

        <SvgField control={form.control} />
      </div>
    </FormDialog>
  );
}
