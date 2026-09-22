import React, { useId, useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { FallbackWorkspaceMark, workspaceMarkDataUrl } from './workspace-mark';

export interface WorkspaceSvgFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

/**
 * Picks a workspace mark. SVG is text, so the file is read in the browser and
 * sent as a string in the ordinary JSON body — there is no multipart endpoint.
 * Shape and size are the schema's job; this only reads the file.
 */
export function WorkspaceSvgField({
  value,
  onChange,
  disabled,
}: WorkspaceSvgFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewLabelId = useId();

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    onChange(await file.text());
  };

  return (
    <div className="flex items-center gap-3">
      <IntegrationIconFrame size="row" aria-labelledby={previewLabelId}>
        {value ? (
          <img
            src={workspaceMarkDataUrl(value)}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          <FallbackWorkspaceMark />
        )}
      </IntegrationIconFrame>

      <div className="flex min-w-0 flex-col gap-1">
        <span id={previewLabelId} className="text-sm font-medium">
          Mark
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            {value ? 'Replace SVG' : 'Upload SVG'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              <X className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* eslint-disable-next-line react/forbid-elements -- a hidden file picker,
          not a text field: the Input primitive styles a control nobody sees. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,.svg"
        className="hidden"
        aria-label="Workspace mark SVG"
        onChange={event => {
          void handleFile(event.target.files?.[0]);
          // Clear the input so picking the same file twice still fires.
          event.target.value = '';
        }}
      />
    </div>
  );
}
