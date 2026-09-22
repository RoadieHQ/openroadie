import { z } from 'zod';

/**
 * Shared validation for the optional "Help URL" field on the add/edit secret
 * dialogs: either empty, or a full https:// URL.
 */
export const helpUrlSchema = z.union(
  [
    z.literal(''),
    z
      .url({ error: 'Enter a full https:// URL' })
      .refine(u => u.startsWith('https://'), 'Enter a full https:// URL'),
  ],
  { error: 'Enter a full https:// URL' },
);

/** Shared spacing for helper text / error messages under the secret fields. */
export const secretFieldMetaClassName = 'mt-1 ml-[14px] text-xs leading-[20px]';

const secretNameSchema = z
  .string()
  .trim()
  .min(1, 'Secret name is required')
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'Use uppercase letters, digits and underscores, e.g. MY_API_TOKEN',
  );

const secretFields = {
  name: secretNameSchema,
  description: z.string().trim(),
  helpUrl: helpUrlSchema,
  value: z.string().trim().min(1, 'Value is required'),
};

/**
 * Builds the shared "create secret" form schema. All call sites (the standalone
 * Add Secret dialog and the integration inline create-secret dialog) share the
 * same field rules; only the duplicate-name guard is opt-in.
 *
 * Pass `existingNames`/`reservedNames` to reject a name that is already taken —
 * used by the integration dialog, which creates secrets against a known list.
 */
export function createSecretSchema(options?: {
  reservedNames?: readonly string[];
  existingNames?: readonly string[];
}) {
  const unavailable = new Set(
    [...(options?.existingNames ?? []), ...(options?.reservedNames ?? [])]
      .map(name => name.trim())
      .filter(name => name.length > 0),
  );

  const base = z.object(secretFields);

  if (unavailable.size === 0) {
    return base;
  }

  return base.superRefine((values, ctx) => {
    if (unavailable.has(values.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: `A secret named "${values.name}" already exists. Choose a different name.`,
      });
    }
  });
}
