import React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@roadiehq/ui/dialog';
import { Spinner } from '@roadiehq/ui/spinner';
import { useAlert, useWorkflows } from '../../api';
import { useWorkflow } from './use-workflow';
import { DataSourceEditorContent } from './data-source-editor';
import { ErrorDisplay } from './data-source-editor/error-display';

interface DataSourceModalProps {
  open: boolean;
  dataSourceId: string | null;
  onClose: () => void;
  onSave?: () => void;
}

export function DataSourceModal({
  open,
  dataSourceId,
  onClose,
  onSave,
}: DataSourceModalProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const { workflow, loading, error, save, saving, execute } = useWorkflow(
    dataSourceId ?? undefined,
  );

  const handleSave: typeof save = async input => {
    const result = await save(input);
    onSave?.();
    return result;
  };

  return (
    <Dialog open={open} onOpenChange={openState => !openState && onClose()}>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] max-w-[95vw] flex-col overflow-hidden border-none bg-surface p-0 shadow-md"
        hideCloseButton
      >
        <DialogTitle className="sr-only">Edit Data Source</DialogTitle>

        {loading && (
          <div className="flex flex-1 items-center justify-center p-4">
            <Spinner size={24} />
          </div>
        )}

        {error && (
          <div className="p-4">
            <ErrorDisplay error={error} title="Failed to load data source" />
          </div>
        )}

        {!loading && !error && workflow && (
          <div className="flex min-h-0 flex-1 flex-col">
            <DataSourceEditorContent
              key={dataSourceId}
              workflow={workflow}
              onSave={handleSave}
              saving={saving}
              onExecute={execute}
              workflowApi={api}
              alertApi={alertApi}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
