import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { FieldValues, UseFormProps, UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';

// Infer the input/output field shapes from the schema rather than from a bare
// `z.ZodType`, whose input widens to `unknown` and fails RHF's `FieldValues`
// constraint (and the zod-v4 zodResolver overload). The form's field values are
// the schema *input* type (what RHF holds pre-resolve); `handleSubmit` yields
// the *output* type.
type UseZodFormProps<
  TInput extends FieldValues,
  TOutput extends FieldValues,
> = Omit<UseFormProps<TInput, unknown, TOutput>, 'resolver'> & {
  schema: z.ZodType<TOutput, TInput>;
};

export function useZodForm<
  TInput extends FieldValues,
  TOutput extends FieldValues,
>({
  schema,
  ...formProps
}: UseZodFormProps<TInput, TOutput>): UseFormReturn<TInput, unknown, TOutput> {
  return useForm<TInput, unknown, TOutput>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    ...formProps,
  });
}
