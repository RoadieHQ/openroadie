/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React, { useState } from 'react';
import { z } from 'zod';
import { Button } from '@roadiehq/ui/button';
import { CopyButton } from '@roadiehq/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@roadiehq/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Spinner } from '@roadiehq/ui/spinner';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { Plus } from 'lucide-react';
import { useZodForm } from '../common';
import type { WebhookTokenSummaryView } from '../../api/webhooks';

const tokenLabelSchema = z.object({
  label: z.string().trim().min(1, 'Label is required'),
});

const defaultValues = { label: '' };

interface CreateTokenDialogProps {
  disabled?: boolean;
  createToken: (
    label: string,
  ) => Promise<WebhookTokenSummaryView & { token: string }>;
}

export function CreateTokenDialog({
  disabled = false,
  createToken,
}: CreateTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const form = useZodForm({ schema: tokenLabelSchema, defaultValues });
  const { isSubmitting } = form.formState;
  const rootError = form.formState.errors.root?.message;

  const resetAll = () => {
    form.reset(defaultValues);
    setCreatedToken(null);
  };

  const handleOpenChange = (next: boolean) => {
    // While the token is being created, or while the one-time token is on
    // screen, only the explicit Done button may close the dialog — a stray
    // Esc/overlay click would otherwise discard a live token.
    if (!next && (isSubmitting || createdToken)) return;
    if (next) resetAll();
    setOpen(next);
  };

  const handleDone = () => {
    setOpen(false);
    resetAll();
  };

  const handleSubmit = form.handleSubmit(async ({ label }) => {
    try {
      const result = await createToken(label);
      setCreatedToken(result.token);
    } catch (e: unknown) {
      form.setError('root', {
        message:
          e instanceof Error ? e.message : 'Failed to create webhook token',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button disabled={disabled} onClick={() => handleOpenChange(true)}>
        <Plus />
        New token
      </Button>
      <DialogContent
        className="sm:max-w-md"
        // Raw dialog (not FormDialog): mask the Outlined* label notch to the
        // surface colour so it matches the other dialog forms.
        style={{ '--field-bg': 'var(--color-surface)' } as React.CSSProperties}
        aria-describedby={undefined}
        hideCloseButton={!!createdToken}
        onEscapeKeyDown={createdToken ? e => e.preventDefault() : undefined}
        onInteractOutside={createdToken ? e => e.preventDefault() : undefined}
      >
        {createdToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-pretty text-muted-foreground">
                Copy this token now — it will not be shown again. Paste it into
                your OSS roadie config under{' '}
                <InlineCode>
                  openroadie.datasourceWebhook.upstream.token
                </InlineCode>
                .
              </p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                <span className="flex-1 truncate">{createdToken}</span>
                <CopyButton value={createdToken} label="Copy token" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={handleSubmit} className="contents" noValidate>
              <DialogHeader>
                <DialogTitle>Create webhook token</DialogTitle>
              </DialogHeader>
              <fieldset disabled={isSubmitting} className="contents">
                <FormField
                  control={form.control}
                  name="label"
                  render={({ field }) => (
                    <FormItem className="space-y-2 pt-2">
                      <FormControl>
                        <OutlinedInput label="Label" {...field} />
                      </FormControl>
                      <FormDescription className="text-xs text-pretty">
                        A name you'll recognize later — e.g. the environment
                        that will use this token.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </fieldset>
              {rootError && (
                <p
                  role="alert"
                  className="text-sm font-medium text-destructive"
                >
                  {rootError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Spinner size={16} /> : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
