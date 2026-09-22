import React, { useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roadiehq/ui/card';
import { FormLoadingView } from '../common';
import { AIProviderForm } from './ai-provider-form';
import {
  useAISettingsContext,
  type AIProvider,
  type ProviderSettings,
} from './ai-settings-context';
import { pageContentClassName } from '../../config/page-layout';
import { cn } from '@roadiehq/ui/utils';

export function AIProvidersPage() {
  const { selectedProvider, settings, saveSettings, isLoading, isConfigured } =
    useAISettingsContext();

  const handleSave = useCallback(
    // Return the promise so the form awaits the save: without it the form
    // resets (marking itself clean) before the backend confirms, and a
    // rejected save never reaches the form's root-error handler.
    (provider: AIProvider, newSettings: ProviderSettings) =>
      saveSettings(provider, newSettings),
    [saveSettings],
  );

  return (
    <div className={cn(pageContentClassName)}>
      <Card>
        <CardHeader>
          <CardTitle>AI Provider Configuration</CardTitle>
          <CardDescription>
            Configure which AI providers and models Roadie can use for
            assistants, summaries, and automations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <FormLoadingView />
          ) : (
            <AIProviderForm
              initialProvider={selectedProvider}
              initialSettings={settings}
              isConfigured={isConfigured}
              onSave={handleSave}
              showCancel={true}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
