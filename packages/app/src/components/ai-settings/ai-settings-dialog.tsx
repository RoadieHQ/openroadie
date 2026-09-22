import React, { useCallback, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@roadiehq/ui/dialog';
import { AIProviderForm } from './ai-provider-form';
import {
  useAISettingsContext,
  type AIProvider,
  type ProviderSettings,
} from './ai-settings-context';

export function AISettingsDialog() {
  const {
    selectedProvider,
    settings,
    saveSettings,
    isDialogOpen,
    closeSettingsDialog,
    isConfigured,
  } = useAISettingsContext();

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(
    async (provider: AIProvider, newSettings: ProviderSettings) => {
      setIsSaving(true);
      try {
        // Rethrown failures surface as the form's root error and keep the
        // dialog open; we only close once the save has been persisted.
        await saveSettings(provider, newSettings);
        closeSettingsDialog();
      } finally {
        setIsSaving(false);
      }
    },
    [saveSettings, closeSettingsDialog],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isSaving) {
        closeSettingsDialog();
      }
    },
    [isSaving, closeSettingsDialog],
  );

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        // Raw dialog (not FormDialog): mask the Outlined* label notch to the
        // surface colour so it matches the other dialog forms.
        style={{ '--field-bg': 'var(--color-surface)' } as React.CSSProperties}
      >
        <DialogHeader>
          <DialogTitle>AI Settings</DialogTitle>
          <DialogDescription>
            Configure your AI provider and credentials to enable AI features
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Remount on every open/close transition so a typed-then-abandoned
              value (e.g. a plaintext API key) never survives a reopen. The
              key stays stable while the dialog is open, so a save failure that
              keeps the dialog open preserves the in-progress edits and the
              root error. */}
          <AIProviderForm
            key={String(isDialogOpen)}
            initialProvider={selectedProvider}
            initialSettings={settings}
            isConfigured={isConfigured}
            onSave={handleSave}
            onCancel={closeSettingsDialog}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
