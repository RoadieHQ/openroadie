import React, { useCallback, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Button } from '@roadiehq/ui/button';

/** A key/value row — structurally the data-source `Header` and action `ActionHeader`. */
export interface KeyValuePair {
  key: string;
  value: string;
}

interface ValueInputProps {
  value: string;
  onChange: (value: string) => void;
}

interface HeadersEditorProps {
  headers: KeyValuePair[] | undefined;
  onChange: (headers: KeyValuePair[]) => void;
  title?: string;
  topAddLabel?: string;
  bottomAddLabel?: string;
  emptyState?: React.ReactNode;
  emptyStateMode?: 'message' | 'button';
  emptyAddLabel?: string;
  nameLabel: string;
  namePlaceholder?: string;
  valueLabel?: string;
  valuePlaceholder?: string;
  renderValueInput?: (props: ValueInputProps) => React.ReactNode;
  rowKey?: (header: KeyValuePair, index: number) => React.Key;
  disabled?: boolean;
  addButtonClassName?: string;
  removeButtonClassName?: string;
  nameContainerClassName?: string;
  valueContainerClassName?: string;
}

export function HeadersEditor({
  headers: headersProp,
  onChange,
  title,
  topAddLabel,
  bottomAddLabel,
  emptyState,
  emptyStateMode = 'message',
  emptyAddLabel = 'Add header',
  nameLabel,
  namePlaceholder,
  valueLabel,
  valuePlaceholder,
  renderValueInput,
  rowKey,
  disabled,
  addButtonClassName,
  removeButtonClassName,
  nameContainerClassName = 'flex-1',
  valueContainerClassName = 'flex-1',
}: HeadersEditorProps) {
  const headers = useMemo(
    () => (Array.isArray(headersProp) ? headersProp : []),
    [headersProp],
  );

  const handleAdd = useCallback(() => {
    onChange([...headers, { key: '', value: '' }]);
  }, [headers, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(headers.filter((_, currentIndex) => currentIndex !== index));
    },
    [headers, onChange],
  );

  const handleUpdate = useCallback(
    (index: number, field: 'key' | 'value', value: string) => {
      onChange(
        headers.map((header, currentIndex) =>
          currentIndex === index ? { ...header, [field]: value } : header,
        ),
      );
    },
    [headers, onChange],
  );

  if (headers.length === 0 && emptyStateMode === 'button') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleAdd}
        disabled={disabled}
        className={addButtonClassName}
      >
        <Plus className="mr-1 size-3.5" />
        {emptyAddLabel}
      </Button>
    );
  }

  return (
    <div>
      {(title || topAddLabel) && (
        <div className="mb-2 flex items-center justify-between">
          {title ? <h4 className="text-sm font-medium">{title}</h4> : <span />}
          {topAddLabel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleAdd}
              disabled={disabled}
              className={addButtonClassName}
            >
              <Plus className="mr-1 size-3.5" />
              {topAddLabel}
            </Button>
          ) : null}
        </div>
      )}
      {headers.length === 0 ? (
        (emptyState ?? null)
      ) : (
        <div className="space-y-2">
          {headers.map((header, index) => (
            <div
              key={rowKey ? rowKey(header, index) : index}
              className="flex items-center gap-2"
            >
              <div className={nameContainerClassName}>
                <OutlinedInput
                  label={nameLabel}
                  value={header.key}
                  onChange={e => handleUpdate(index, 'key', e.target.value)}
                  placeholder={namePlaceholder}
                  disabled={disabled}
                />
              </div>
              <div className={valueContainerClassName}>
                {renderValueInput ? (
                  renderValueInput({
                    value: header.value,
                    onChange: value => handleUpdate(index, 'value', value),
                  })
                ) : (
                  <OutlinedInput
                    label={valueLabel ?? 'Value'}
                    value={header.value}
                    onChange={e => handleUpdate(index, 'value', e.target.value)}
                    placeholder={valuePlaceholder}
                    disabled={disabled}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={removeButtonClassName}
                onClick={() => handleRemove(index)}
                disabled={disabled}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {bottomAddLabel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleAdd}
              disabled={disabled}
              className={addButtonClassName}
            >
              <Plus className="mr-1 size-3.5" />
              {bottomAddLabel}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
