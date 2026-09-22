import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { Button } from '@roadiehq/ui/button';

interface UseAdvancedModeStateArgs<T> {
  initialStructured?: T;
  initialExpression?: string;
  emptyStructured: T;
  parse: (expression: string) => T | null;
  compile: (structured: T) => string;
  onChange: (structured: T | undefined, expression: string) => void;
}

interface InternalState<T> {
  structured: T;
  expression: string;
  advancedMode: boolean;
  migrationBanner: boolean;
}

function deriveInitialState<T>(
  args: UseAdvancedModeStateArgs<T>,
): InternalState<T> {
  const {
    initialStructured,
    initialExpression,
    emptyStructured,
    parse,
    compile,
  } = args;

  if (initialStructured !== undefined) {
    return {
      structured: initialStructured,
      expression: compile(initialStructured),
      advancedMode: false,
      migrationBanner: false,
    };
  }

  if (initialExpression && initialExpression.trim().length > 0) {
    const parsed = parse(initialExpression);
    if (parsed !== null) {
      return {
        structured: parsed,
        expression: initialExpression,
        advancedMode: false,
        migrationBanner: false,
      };
    }
    return {
      structured: emptyStructured,
      expression: initialExpression,
      advancedMode: true,
      migrationBanner: true,
    };
  }

  return {
    structured: emptyStructured,
    expression: compile(emptyStructured),
    advancedMode: false,
    migrationBanner: false,
  };
}

export interface UseAdvancedModeState<T> {
  structured: T;
  expression: string;
  advancedMode: boolean;
  confirmOpen: boolean;
  /**
   * Update the structured state. Accepts either a value or an updater function
   * — use the function form (`prev => next`) when chaining multiple updates in
   * the same render frame, otherwise the second call reads a stale closure.
   */
  setStructured: (next: T | ((prev: T) => T)) => void;
  setAdvancedExpression: (expression: string) => void;
  toggleAdvanced: (next: boolean) => void;
  confirmExitAdvanced: () => void;
  cancelExitAdvanced: () => void;
}

export function useAdvancedModeState<T>(
  args: UseAdvancedModeStateArgs<T>,
): UseAdvancedModeState<T> {
  const { emptyStructured, parse, compile, onChange } = args;

  const [state, setState] = useState<InternalState<T>>(() =>
    deriveInitialState(args),
  );
  const [advancedPristine, setAdvancedPristine] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Mirrors of state for callbacks chained in the same render frame so they
  // see the latest values regardless of stale closures.
  const structuredRef = useRef(state.structured);
  structuredRef.current = state.structured;
  const advancedPristineRef = useRef(advancedPristine);
  advancedPristineRef.current = advancedPristine;
  const stateRef = useRef(state);
  stateRef.current = state;

  const setStructured = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (p: T) => T)(structuredRef.current)
          : next;
      structuredRef.current = resolved;
      const compiled = compile(resolved);
      setState(prev => ({
        ...prev,
        structured: resolved,
        expression: compiled,
        migrationBanner: false,
      }));
      onChange(resolved, compiled);
    },
    [compile, onChange],
  );

  const setAdvancedExpression = useCallback(
    (next: string) => {
      setState(prev => ({ ...prev, expression: next }));
      setAdvancedPristine(false);
      onChange(undefined, next);
    },
    [onChange],
  );

  const toggleAdvanced = useCallback((next: boolean) => {
    if (next) {
      setState(prev => ({ ...prev, advancedMode: true }));
      setAdvancedPristine(true);
      return;
    }
    // Silent exit only when the user explicitly toggled into advanced AND
    // hasn't typed anything yet. If we entered advanced because the saved
    // expression couldn't be auto-converted (migrationBanner state), confirm
    // before discarding it. Read both via refs so we see the latest values
    // even when multiple toggles batch in one render frame.
    if (advancedPristineRef.current && !stateRef.current.migrationBanner) {
      setState(prev => ({
        ...prev,
        advancedMode: false,
        migrationBanner: false,
      }));
      return;
    }
    setConfirmOpen(true);
  }, []);

  const confirmExitAdvanced = useCallback(() => {
    // Read the latest expression via ref so a typed-then-immediately-clicked
    // Continue captures the user's most recent input.
    const currentExpression = stateRef.current.expression;
    const parsed = parse(currentExpression);
    const nextStructured = parsed ?? emptyStructured;
    const nextExpr = parsed ? currentExpression : compile(emptyStructured);
    setState({
      structured: nextStructured,
      expression: nextExpr,
      advancedMode: false,
      migrationBanner: false,
    });
    setAdvancedPristine(true);
    setConfirmOpen(false);
    onChange(nextStructured, nextExpr);
  }, [compile, emptyStructured, onChange, parse]);

  const cancelExitAdvanced = useCallback(() => setConfirmOpen(false), []);

  // Memoize the return object so consumers' useCallback hooks that depend on
  // it actually memoize across renders.
  return useMemo(
    () => ({
      structured: state.structured,
      expression: state.expression,
      advancedMode: state.advancedMode,
      confirmOpen,
      setStructured,
      setAdvancedExpression,
      toggleAdvanced,
      confirmExitAdvanced,
      cancelExitAdvanced,
    }),
    [
      state.structured,
      state.expression,
      state.advancedMode,
      confirmOpen,
      setStructured,
      setAdvancedExpression,
      toggleAdvanced,
      confirmExitAdvanced,
      cancelExitAdvanced,
    ],
  );
}

export function AdvancedConfirmBanner({
  onConfirm,
  onCancel,
  testId,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
}) {
  return (
    <Alert
      variant="default"
      data-testid={testId}
      className="border-info/40 bg-info/10"
    >
      <Sparkles className="size-4" />
      <AlertTitle>Switch back to the builder?</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>
          We&apos;ll re-parse your raw expression. If it can&apos;t be
          represented in the builder, it will be cleared.
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onConfirm}>
            Continue
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
