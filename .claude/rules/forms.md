---
paths:
  - 'packages/app/**/*.{ts,tsx}'
---

# Forms

## When this applies

Any form in `packages/app` — dialogs, editor pages, inline settings panels. If the user types into fields and something is saved, these rules apply.

## The stack

- **Schema:** a `zod` schema owns validation and value transformation.
- **Hook:** `useZodForm({ schema, defaultValues })` from `components/common` — wires `zodResolver` and `mode: 'onChange'`. Never hand-roll a resolver or duplicate validation in the component.
- **UI:** `@roadiehq/ui/form` primitives (`Form`, `FormField`, `FormItem`, `FormControl`, `FormMessage`, `FormDescription`).

## Real `<form>` + button types

- Fields live inside a real `<form onSubmit={form.handleSubmit(...)}>` so Enter submits.
- The submit button is `type="submit"`. Every other button inside the form is `type="button"` — otherwise it submits the form.

## Field anatomy

```tsx
<FormField
  control={form.control}
  name="slug"
  render={({ field }) => (
    <FormItem>
      <FormControl>
        <OutlinedInput label="Slug *" {...field} />
      </FormControl>
      <FormDescription>Lowercase, hyphen-separated.</FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

- `FormControl` wires `id`, `aria-invalid`, and `aria-describedby` onto the input — always wrap the control in it.
- Helper text goes in `FormDescription` (announced to screen readers), errors render via `FormMessage`.
- `FormItem` has no built-in spacing — the parent layout owns gaps (`flex flex-col gap-5` etc.).
- **Label notch background:** the `Outlined*` fields' floating label masks the top border with `--field-bg` (default `var(--color-card)`). `FormDialog` already sets `--field-bg: var(--color-surface)` for you, so forms inside it need nothing. Only set it yourself when the fields sit somewhere else, or the label shows a mismatched rectangle: `style={{ '--field-bg': 'var(--color-background)' }}` on a page shell, `var(--color-surface)` on a raw (non-`FormDialog`) dialog, `var(--color-card)` on a card panel.

## Pending state

Use `form.formState.isSubmitting` — disable the submit button and wrap the body in `<fieldset disabled={isSubmitting}>`. Don't track a separate `saving` state.

## Dialog forms

Use `FormDialog` from `components/common`:

- **Reset-on-open is the caller's job:** use `useResetFormOnOpen(form, open, () => values)` from `components/common` (a thin effect keyed on `open`), or remount the dialog. `FormDialog` never resets.
- Close is blocked while submitting; don't add your own guard.
- API/save errors go to `form.setError('root', { message })` and render **in the dialog** — `FormDialog` does this for errors thrown from `onSubmit`. Never toast a validation or save error while the dialog is open.

```tsx
const form = useZodForm({ schema: widgetSchema, defaultValues });

<FormDialog
  open={open}
  onOpenChange={setOpen}
  title="Edit widget"
  form={form}
  submitLabel="Save"
  onSubmit={async values => {
    await api.saveWidget(values); // throw → shown as root error, dialog stays open
    setOpen(false);
  }}
>
  <FormField ... />
</FormDialog>;
```

## Anti-patterns

- Hand-rolled `useState`-per-field forms when there is more than one field.
- Validation logic in the component instead of the zod schema.
- Buttons inside a form without an explicit `type`.
- Toasting validation/save errors from a dialog instead of `errors.root`.
- Resetting form state inside a shared dialog component.
- A `div` with a click-handler "submit" instead of a real `<form>`.

## Accepted exceptions

These deviate from the rules above on purpose — don't "fix" them, and don't treat them as the pattern to copy:

- **A raw dialog wrapping a form that's also used on a page** (e.g. AI settings) may keep its own pending flag to gate close, because it can't read the embedded child form's `isSubmitting`. A dialog that owns its form should use `FormDialog` instead.
- **Route editors with interactive list state** (e.g. context groups' datasource/relationship-type lists) may keep that list state in `useState` with a `setError('root')` "at least one …" check rather than forcing it through the zod schema — as long as the error still lands on `root` and is never toasted. Plain scalar fields in those editors still go through `useZodForm`.
- **Inline single-field editors inside another `<form>`** (e.g. the required-secrets value editor) can't nest a `<form>`, so they wire Enter/submit by hand. This applies only to a genuinely single field embedded in a larger form.
