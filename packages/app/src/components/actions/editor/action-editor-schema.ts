import { z } from 'zod';
import { isValidStepId } from '@roadiehq/actions-common';
import { isValidSlug } from '@roadiehq/scopes-common';
import type { ActionParam, ActionStep } from '../../../api';

/**
 * Validation for the action editor. The bespoke `ParameterBuilder` / `StepList`
 * sub-editors own the shape of `parameters` / `steps`, so those are held as
 * opaque values (`z.custom`) and validated as a whole here — this schema is the
 * single source of the editor's save-time rules. Sub-editors may render
 * field-local messages; the editor toasts the first global error on submit.
 */
export const actionEditorSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    parameters: z.array(z.custom<ActionParam>()),
    steps: z.array(z.custom<ActionStep>()),
  })
  .superRefine((draft, ctx) => {
    if (!draft.name.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Name is required',
      });
    }

    // The slug is optional — the editor omits it when blank and the backend
    // derives one. A non-empty slug must match the grammar, or it can never
    // appear in an `@action:<slug>` token nor be a token-scope target.
    const slug = draft.slug.trim();
    if (slug && !isValidSlug(slug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'Use lowercase letters, numbers and single hyphens',
      });
    }

    const stepIds = draft.steps.map(s => s.id);
    const stepIdsValid =
      stepIds.every(isValidStepId) && new Set(stepIds).size === stepIds.length;
    // Report one step problem at a time, matching the previous save-order
    // precedence (ids → integration → path) so the message stays specific.
    if (!stepIdsValid) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Fix step ids (invalid or duplicate)',
      });
    } else if (draft.steps.some(s => !s.integrationId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Every step needs an integration',
      });
    } else if (
      draft.steps.some(
        step =>
          step.request.backendType === 'aws' &&
          (!step.request.profile.trim() ||
            !step.request.region.trim() ||
            !step.request.service.trim()),
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Every AWS step needs an account, region and service',
      });
    } else if (draft.steps.some(s => !s.request.path.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Every step needs a request path',
      });
    }

    const paramNames = draft.parameters.map(p => p.name.trim());
    const paramsValid =
      !paramNames.some(n => n === '') &&
      new Set(paramNames).size === paramNames.length;
    if (!paramsValid) {
      ctx.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Fix parameter names (empty or duplicate)',
      });
    }
  });

export type ActionEditorValues = z.infer<typeof actionEditorSchema>;
