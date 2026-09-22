import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { AIButton } from '../../ai-settings';
import { Input } from '@roadiehq/ui/input';
import { Textarea } from '@roadiehq/ui/textarea';
import { Alert, AlertDescription } from '@roadiehq/ui/alert';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { FieldHint } from '@roadiehq/ui/field-hint';
import type { JsonataAssistServiceLike } from './jsonata-assist-types';

export interface JsonataExpressionFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  helperText?: string;
  transformType?: 'filter' | 'map';
  inputSample?: unknown;
  jsonataAssist?: JsonataAssistServiceLike;
  disabled?: boolean;
  testId?: string;
  onRun?: (expression: string) => void;
  /** Start the textarea shorter — for dense surfaces like the stepped rule
   * editor's config cards. Still user-resizable. */
  compact?: boolean;
}

export const JsonataExpressionField = memo(function JsonataExpressionField({
  value,
  onChange,
  label,
  placeholder,
  helperText,
  transformType,
  inputSample,
  jsonataAssist,
  disabled,
  testId,
  onRun,
  compact = false,
}: JsonataExpressionFieldProps) {
  const inputId = React.useId();
  const helperId = React.useId();
  const [description, setDescription] = useState('');
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onRunRef = useRef(onRun);
  const mountedRef = useRef(true);
  const generatingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onRunRef.current = onRun;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const hasAiAssist =
    jsonataAssist !== undefined &&
    inputSample !== null &&
    inputSample !== undefined;

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || !jsonataAssist || generatingRef.current) {
      return;
    }

    generatingRef.current = true;
    setLoading(true);
    setError(null);
    setStreamingText('');

    let lastText = '';
    let timedOut = false;
    const timeoutMs = 60000;
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('Generation timed out'));
      }, timeoutMs);
      timeoutRef.current = timeoutId;
    });

    try {
      await Promise.race([
        jsonataAssist.stream(
          { inputSample, description, transformType },
          text => {
            if (!mountedRef.current || timedOut) {
              return;
            }
            lastText = text;
            setStreamingText(text);
          },
          () => {
            if (!mountedRef.current || timedOut) {
              return;
            }
            clearTimeout(timeoutId);
            setStreamingText(null);
            setLoading(false);
            generatingRef.current = false;
            setDescription('');
            onRunRef.current?.(lastText);
          },
          err => {
            if (!mountedRef.current || timedOut) {
              return;
            }
            clearTimeout(timeoutId);
            setStreamingText(null);
            setError(err.message);
            setLoading(false);
            generatingRef.current = false;
          },
        ),
        timeoutPromise,
      ]);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      setStreamingText(null);
      setError(
        err instanceof Error ? err.message : 'Failed to generate expression',
      );
      setLoading(false);
      generatingRef.current = false;
    }
  }, [description, inputSample, transformType, jsonataAssist]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && description.trim()) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [description, handleGenerate],
  );

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex items-center gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            {label}
          </label>
          {helperText && compact && (
            <FieldHint ariaLabel={`${label} help`}>{helperText}</FieldHint>
          )}
        </div>
        {helperText &&
          (compact ? (
            <span id={helperId} className="sr-only">
              {helperText}
            </span>
          ) : (
            <p id={helperId} className="text-xs text-muted-foreground">
              {helperText}
            </p>
          ))}
      </div>
      <Textarea
        id={inputId}
        aria-describedby={helperText ? helperId : undefined}
        value={streamingText ?? value}
        onChange={
          streamingText !== null ? undefined : e => onChange(e.target.value)
        }
        placeholder={placeholder}
        readOnly={disabled || streamingText !== null}
        data-testid={testId}
        className={cn(
          'w-full resize-y font-mono',
          compact ? 'min-h-[60px]' : 'min-h-[100px]',
          (disabled || streamingText !== null) && 'opacity-50',
        )}
      />

      {hasAiAssist && (
        <div className="relative">
          <Sparkles className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" />
          <Input
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              transformType === 'filter'
                ? 'Describe your filter in plain English...'
                : 'Describe the transformation...'
            }
            disabled={disabled || loading}
            className="pr-20 pl-9 text-sm"
          />
          {description.trim() && (
            <div className="absolute top-1/2 right-2 -translate-y-1/2">
              <AIButton
                size="sm"
                variant="ghost"
                onClick={handleGenerate}
                disabled={loading || !description.trim()}
                className="h-7 px-2 text-xs"
              >
                {loading ? <Spinner size={14} /> : 'Generate'}
              </AIButton>
            </div>
          )}
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="py-1">
          <AlertDescription className="flex items-center justify-between py-0.5 text-sm">
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setError(null)}
              className="h-5 px-1 text-xs"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
});
