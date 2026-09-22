import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Ajv from 'ajv';
import { buildSampleInput, compileInputSchema } from '@roadiehq/actions-common';
import { useActions as useActionsApi } from '../../../api';
import type { ActionParam, ActionStep, ExecuteResult } from '../types';

/**
 * Owns the actions test-run: a JSON inputs buffer (seeded from a sample built
 * off the parameters), Ajv validation against the parameter schema, and the
 * one-shot draft execution. Lifted out of the old ActionTestRunner so the run
 * can be driven from the editor header while the results render in the shared
 * details panel.
 */
export function useActionTestRun({
  parameters,
  steps,
}: {
  parameters: ActionParam[];
  steps: ActionStep[];
}) {
  const actionsApi = useActionsApi();
  const ajv = useMemo(
    () => new Ajv({ allErrors: true, strict: false, useDefaults: true }),
    [],
  );

  const sample = useMemo(
    () => JSON.stringify(buildSampleInput(parameters), null, 2),
    [parameters],
  );

  const [inputText, setInputText] = useState(sample);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Follow `sample` until the user edits the buffer. Without this, opening a
  // saved action seeds from the empty first render and never picks up params
  // once the definition loads.
  const previousSampleRef = useRef(sample);
  useEffect(() => {
    setInputText(prev => (prev === previousSampleRef.current ? sample : prev));
    previousSampleRef.current = sample;
  }, [sample]);

  // React Query owns the in-flight execution: `isPending` is the busy flag and
  // `data` is the latest result. A new `mutate` supersedes any earlier in-flight
  // run, so no manual request-id/sequence guard is needed.
  const runMutation = useMutation({
    mutationFn: (inputs: Record<string, unknown>) =>
      actionsApi.executeDraft({ parameters, steps }, inputs),
  });
  const {
    mutate,
    reset: resetMutation,
    data,
    isPending: running,
  } = runMutation;
  const result: ExecuteResult | null = data ?? null;

  const clearRun = useCallback(() => {
    resetMutation();
    setValidationError(null);
  }, [resetMutation]);

  // Clear a stale result whenever the definition *content* changes. Key off a
  // serialization so new array/object identities from form.watch() don't wipe
  // an in-flight or completed run. `clearRun` is intentionally omitted from
  // deps — resetMutation's identity can change after a reset and would loop.
  const definitionKey = useMemo(
    () => JSON.stringify({ parameters, steps }),
    [parameters, steps],
  );
  useEffect(() => {
    clearRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [definitionKey]);

  const resetInputs = useCallback(() => {
    setInputText(sample);
    clearRun();
  }, [sample, clearRun]);

  const run = useCallback(() => {
    setValidationError(null);
    resetMutation();

    let inputs: Record<string, unknown>;
    try {
      inputs = JSON.parse(inputText || '{}');
    } catch {
      setValidationError('Inputs must be valid JSON');
      return;
    }

    const validate = ajv.compile(compileInputSchema(parameters));
    if (!validate(inputs)) {
      const first = validate.errors?.[0];
      setValidationError(
        first
          ? `${first.instancePath || '(root)'} ${first.message}`
          : 'Inputs do not match the parameter schema',
      );
      return;
    }

    mutate(inputs, {
      onError: (e: unknown) => {
        setValidationError(e instanceof Error ? e.message : 'Request failed');
      },
    });
  }, [ajv, parameters, inputText, mutate, resetMutation]);

  return {
    inputText,
    setInputText,
    resetInputs,
    validationError,
    run,
    running,
    result,
  };
}
